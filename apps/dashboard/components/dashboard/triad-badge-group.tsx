import { StatusBadge, type StatusTone } from "../ui/status-badge";

export interface TriadBadgeGroupProps {
  ruleResult?: string | null | undefined;
  aiRecommendation?: string | null | undefined;
  baDecision?: string | null | undefined;
  compact?: boolean;
}

function resolveRuleTone(value?: string | null): StatusTone {
  if (!value) return "neutral";
  if (value === "PAUSE" || value === "TRIGGERED") return "danger";
  if (value === "CONTINUE" || value === "CLEAR") return "success";
  if (value === "INSUFFICIENT_DATA" || value === "NOT_EVALUATED") return "warning";
  return "neutral";
}

function resolveAiTone(value?: string | null): StatusTone {
  if (!value) return "neutral";
  if (value === "PAUSE") return "danger";
  if (value === "WATCH") return "warning";
  if (value === "SCALE" || value === "CONTINUE") return "success";
  return "neutral";
}

function resolveBaTone(value?: string | null): StatusTone {
  if (!value) return "neutral";
  if (value === "PAUSE") return "danger";
  if (value === "SLOW_SELL" || value === "WATCH") return "warning";
  if (value === "SCALE" || value === "CONTINUE") return "success";
  return "neutral";
}

export function TriadBadgeGroup({
  ruleResult,
  aiRecommendation,
  baDecision,
  compact = false,
}: TriadBadgeGroupProps) {
  return (
    <div className={`triad-group ${compact ? "triad-group--compact" : ""}`.trim()}>
      <div className="triad-item">
        <span className="triad-label">Rule</span>
        <StatusBadge tone={resolveRuleTone(ruleResult)}>
          {ruleResult ?? "N/A"}
        </StatusBadge>
      </div>
      <span className="triad-arrow" aria-hidden="true">→</span>
      <div className="triad-item">
        <span className="triad-label">AI</span>
        <StatusBadge tone={resolveAiTone(aiRecommendation)}>
          {aiRecommendation ?? "N/A"}
        </StatusBadge>
      </div>
      <span className="triad-arrow" aria-hidden="true">→</span>
      <div className="triad-item">
        <span className="triad-label">BA</span>
        <StatusBadge tone={resolveBaTone(baDecision)}>
          {baDecision ?? "Chưa duyệt"}
        </StatusBadge>
      </div>
    </div>
  );
}
