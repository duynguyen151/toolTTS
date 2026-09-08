[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$SpreadsheetId,

  [string]$SheetName = 'Tháng 9-US',
  [ValidateRange(1, 1000000)]
  [int]$Row = 11,
  [ValidatePattern('^[A-Za-z]{1,3}$')]
  [string]$OrderIdColumn = 'B',
  [ValidatePattern('^[A-Za-z]{1,3}$')]
  [string]$ProviderColumn = 'AC',
  [switch]$Post
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$googleTokenPath = Join-Path $repoRoot 'OauthGoogle/google-oauth-token.dpapi.json'
$googleClientPath = Get-ChildItem (Join-Path $repoRoot 'OauthGoogle') -Filter 'client_secret_*.json' -File | Select-Object -First 1 -ExpandProperty FullName

function Get-LocalEnvValue([string]$Name) {
  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue.Trim() }

  $envPath = Join-Path $repoRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath)) { return $null }
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length - 1] -eq '"') -or ($value[0] -eq "'" -and $value[$value.Length - 1] -eq "'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Get-GoogleTokenEnvelope {
  if (-not (Test-Path -LiteralPath $googleTokenPath)) {
    throw "Google OAuth token file not found: $googleTokenPath"
  }
  Add-Type -AssemblyName System.Security
  $outer = Get-Content -Raw -LiteralPath $googleTokenPath | ConvertFrom-Json
  if ($outer.format -ne 'windows-dpapi' -or $outer.scope -ne 'CurrentUser') {
    throw 'Unsupported Google OAuth token file format or DPAPI scope'
  }
  $encrypted = [Convert]::FromBase64String([string]$outer.data)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $encrypted,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  return [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
}

function Get-GoogleAccessToken {
  $envelope = Get-GoogleTokenEnvelope
  $stored = $envelope.token
  if ($null -eq $stored.refresh_token -or [string]::IsNullOrWhiteSpace([string]$stored.refresh_token)) {
    throw 'Google OAuth token has no refresh token'
  }
  if (-not (Test-Path -LiteralPath $googleClientPath)) {
    throw 'Google OAuth client secret file not found'
  }

  $client = Get-Content -Raw -LiteralPath $googleClientPath | ConvertFrom-Json
  $clientConfig = if ($null -ne $client.installed) { $client.installed } else { $client.web }
  if ($null -eq $clientConfig) { throw 'Google OAuth client config is missing installed/web settings' }

  # Refresh on every one-shot run so an old cached access token cannot fail the test.
  $tokenResponse = Invoke-RestMethod -Method Post `
    -Uri 'https://oauth2.googleapis.com/token' `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{
      client_id = [string]$clientConfig.client_id
      client_secret = [string]$clientConfig.client_secret
      refresh_token = [string]$stored.refresh_token
      grant_type = 'refresh_token'
    }
  if ([string]::IsNullOrWhiteSpace([string]$tokenResponse.access_token)) {
    throw 'Google OAuth refresh returned no access token'
  }
  return [string]$tokenResponse.access_token
}

function Get-ColumnIndex([string]$Column) {
  $value = 0
  foreach ($character in $Column.ToUpperInvariant().ToCharArray()) {
    $value = ($value * 26) + ([int][char]$character - [int][char]'A' + 1)
  }
  return $value - 1
}

function Invoke-GoogleValuesGet([string]$AccessToken, [string]$Range) {
  $encodedRange = [Uri]::EscapeDataString($Range)
  $uri = "https://sheets.googleapis.com/v4/spreadsheets/$SpreadsheetId/values/${encodedRange}?majorDimension=ROWS"
  $response = Invoke-WebRequest -Method Get -Uri $uri -Headers @{
    Authorization = "Bearer $AccessToken"
    Accept = 'application/json'
  } -SkipHttpErrorCheck
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "Google Sheets read failed with HTTP $($response.StatusCode)"
  }
  return $response.Content | ConvertFrom-Json
}

function Get-CotikToken {
  $token = Get-LocalEnvValue 'COTIK_TOKEN'
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'COTIK_TOKEN is not configured in the environment or .env' }
  return $token.Trim()
}

function Invoke-Cotik([string]$Token, [ValidateSet('GET', 'POST')][string]$Method, [string]$Path, [string]$JsonBody) {
  $baseUrl = (Get-LocalEnvValue 'COTIK_BASE_URL')
  if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = 'https://cotik.app/api' }
  $uri = "$($baseUrl.TrimEnd('/'))/$($Path.TrimStart('/'))"
  $headers = @{
    'al-token' = $Token
    Accept = 'application/json'
    'User-Agent' = 'tool-tts-tracking-test/1.0'
  }
  $request = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
    SkipHttpErrorCheck = $true
  }
  if ($Method -eq 'POST') {
    $request.ContentType = 'application/json'
    $request.Body = $JsonBody
  }
  $response = Invoke-WebRequest @request
  try { $body = $response.Content | ConvertFrom-Json } catch { throw "COTIK returned non-JSON HTTP $($response.StatusCode)" }
  $bodyStatus = [int]$body.status
  if ($response.StatusCode -eq 429 -or $bodyStatus -eq 429) { throw 'COTIK rate limit reached; no retry was attempted by this one-shot test' }
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300 -or $bodyStatus -ne 200) {
    $message = if ($null -ne $body.message) { [string]$body.message } else { 'no message' }
    throw "COTIK rejected the request: HTTP $($response.StatusCode), body.status $bodyStatus, $message"
  }
  return $body
}

if (-not (Test-Path -LiteralPath $googleClientPath)) { throw 'No local Google OAuth client secret file found' }
$googleAccessToken = Get-GoogleAccessToken
$range = "'$($SheetName.Replace("'", "''"))'!A1:AC$Row"
$sheetData = Invoke-GoogleValuesGet $googleAccessToken $range
$rows = @($sheetData.values)
if ($rows.Count -lt $Row) { throw "Google Sheet returned only $($rows.Count) rows; row $Row is unavailable" }

$rowValues = @($rows[$Row - 1])
$orderIdIndex = Get-ColumnIndex $OrderIdColumn
if ($null -eq $orderIdIndex) { throw 'Could not find an OrderID header; rerun with -OrderIdColumn, for example -OrderIdColumn B' }
if ($orderIdIndex -ge $rowValues.Count) { throw "OrderID column is empty on row $Row" }
if ($rowValues.Count -le 25) { throw "Column Z is empty or outside the returned row on row $Row" }

$orderId = ([string]$rowValues[$orderIdIndex]).Trim()
$trackingNumber = ([string]$rowValues[25]).Trim()
$providerIndex = Get-ColumnIndex $ProviderColumn
if ($providerIndex -ge $rowValues.Count) { throw "Provider column is empty or outside the returned row on row $Row" }
$provider = ([string]$rowValues[$providerIndex]).Trim()
if ([string]::IsNullOrWhiteSpace($orderId)) { throw "OrderID is empty on row $Row" }
if ([string]::IsNullOrWhiteSpace($trackingNumber)) { throw "Tracking number is empty in Z$Row" }
if ([string]::IsNullOrWhiteSpace($provider)) { throw "Provider is empty in $ProviderColumn$Row" }

Write-Host "Sheet row: $SheetName / $Row"
Write-Host "Cotik OrderID (B): $orderId"
Write-Host "Tracking: $trackingNumber"
Write-Host "Provider (AC): $provider"

if ($Post) {
  throw 'Direct POST is disabled. Use the database intent ledger with `shop-health cotik-tracking stage-sheet-date`; the worker is the only allowed Cotik POST caller.'
}

$cotikToken = Get-CotikToken
$encodedOrderId = [Uri]::EscapeDataString($orderId)
$lookupPath = "order/list?page=1&sizeperpage=10&search=$encodedOrderId"
$lookup = Invoke-Cotik $cotikToken 'GET' $lookupPath $null
$matches = @($lookup.data.listorders | Where-Object { [string]$_.apiOrderId -eq $orderId })
if ($matches.Count -ne 1) { throw "COTIK exact OrderID lookup returned $($matches.Count) matching orders" }
$order = $matches[0]

$currentTracking = ([string]$order.tracking_number).Trim()
$shippingType = ([string]$order.shipping_type).Trim().ToUpperInvariant()
$workStatus = ([string]$order.order_status).Trim().ToLowerInvariant()
Write-Host "COTIK shipping type: $(if ($shippingType) { $shippingType } else { 'missing' })"
Write-Host "COTIK work status: $(if ($workStatus) { $workStatus } else { 'missing' })"
Write-Host "COTIK current tracking: $(if ($currentTracking) { $currentTracking } else { '(empty)' })"

if ($shippingType -ne 'SELLER') { throw "COTIK order is not SELLER shipping; refusing to post" }
if ($workStatus -notin @('new', 'working', 'worked')) { throw "COTIK work status '$workStatus' is not eligible for tracking update" }
if ($currentTracking -and $currentTracking -ne $trackingNumber) { throw 'COTIK already has a different tracking number; refusing to overwrite it' }

Write-Host 'READ-ONLY: no COTIK write sent. Stage through the DB ledger before any explicitly authorized worker acceptance batch.'
