import type { DashboardDecisionCenter, DashboardPresentation } from "../../lib/dashboard-contract";
import { LiveBaForm } from "./live-ba-form.js";

type Props = {
  dataOrigin: DashboardPresentation["dataOrigin"];
  center?: DashboardDecisionCenter | undefined;
};

function List({ items, empty = "Unavailable" }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p>{empty}</p>;
  return <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}

function Evidence({ owner, source, observedAt }: { owner: string; source: string; observedAt: string }) {
  const label = {
    CURRENT_OPERATIONAL_FACTS: "Current operational facts",
    IMMUTABLE_DECISION_CASE: "Immutable Decision Case",
    AI_DECISION: "Linked AI Decision",
    BA_DECISION_REVISION: "BA decision revision",
    DRY_RUN_EXECUTION: "Dry-run execution",
  }[owner] ?? owner;
  return <p><small>{label} · {source} · observed {observedAt} · GMT+07</small></p>;
}

export function LiveDecisionCenter({ dataOrigin, center }: Props) {
  if (dataOrigin !== "LIVE") {
    return (
      <section aria-labelledby="decision-center-heading">
        <p>Decision Center</p>
        <h2 id="decision-center-heading">Live decision center unavailable</h2>
        <p>Only persisted LIVE data is shown here. No fixture or demo decision data is mounted.</p>
      </section>
    );
  }

  const view = center;
  if (view === undefined) {
    return (
      <section aria-labelledby="decision-center-heading">
        <p>Live read model</p>
        <h2 id="decision-center-heading">Shop Decision Center</h2>
        <p>Decision evidence is unavailable because no persisted decision case was returned.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="decision-center-heading">
      <header>
        <p>Live read model</p>
        <h2 id="decision-center-heading">Shop Decision Center</h2>
        <p>{view.message}</p>
        <Evidence owner={view.reviewSnapshot?.owner ?? "IMMUTABLE_DECISION_CASE"} source={view.reviewSnapshot?.source ?? "DECISION_CASE"} observedAt={view.reviewSnapshot?.observedAt ?? "Unavailable"} />
      </header>

      <section aria-labelledby="decision-center-coverage">
        <h3 id="decision-center-coverage">Data health</h3>
        <dl>
          <div><dt>Status</dt><dd>{view.coverage.status}</dd></div>
          <div><dt>Source</dt><dd>{view.coverage.source}</dd></div>
          <div><dt>Proven window</dt><dd>{view.coverage.provenWindow}</dd></div>
          <div><dt>Reconciled</dt><dd>{view.coverage.sourceReconciled}</dd></div>
          <div><dt>Freshness</dt><dd>{view.coverage.freshness}</dd></div>
          <div><dt>Finance captured</dt><dd>{view.coverage.financeCapturedAt ?? "Unavailable"}</dd></div>
          <div><dt>Finance age</dt><dd>{view.coverage.financeAgeMs === null ? "Unavailable" : `${view.coverage.financeAgeMs} ms`}</dd></div>
          <div><dt>Complete within window</dt><dd>{view.coverage.completeWithinWindow}</dd></div>
          <div><dt>Lifetime history</dt><dd>{view.coverage.lifetimeHistory}</dd></div>
        </dl>
        <Evidence {...view.coverage.evidence} />
        {view.coverage.staleDisclosure === null ? null : <p>{view.coverage.staleDisclosure}</p>}
      </section>

      <section aria-labelledby="decision-center-metrics">
        <h3 id="decision-center-metrics">Verified metrics</h3>
        <dl>
          {view.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.detail}</small><Evidence {...metric.evidence} /></div>)}
        </dl>
      </section>

      <section aria-labelledby="decision-center-trends">
        <h3 id="decision-center-trends">Trend comparisons</h3>
        <Evidence {...view.rule.evidence} />
        <List items={view.comparisons.map((comparison) => `${comparison.metric}: previous ${comparison.previous} · current ${comparison.current} · absolute delta ${comparison.absoluteDelta} · relative delta ${comparison.relativeDelta} · ${comparison.direction}`)} />
        <h4>Trend signals</h4>
        {view.trends.length === 0 ? <p>Trend evidence unavailable or NOT_EVALUATED; no frozen trend signals were recorded.</p> : view.trends.map((trend) => (
          <article key={trend.signal}>
            <strong>{trend.signal}</strong>
            <span>{trend.status}</span>
            <p>Reason: {trend.reason}</p>
            <List items={trend.comparisons.map((comparison) => `${comparison.metric}: previous ${comparison.previous} · current ${comparison.current} · absolute delta ${comparison.absoluteDelta} · relative delta ${comparison.relativeDelta} · ${comparison.direction}`)} />
          </article>
        ))}
      </section>

      <section aria-labelledby="decision-center-rule">
        <h3 id="decision-center-rule">Deterministic rule evidence</h3>
        <p>Result: <strong>{view.rule.result}</strong></p>
        <p>Policy: {view.rule.policyVersion}</p>
        <p>Frozen effective policy: {view.effectivePolicy?.policyVersion ?? "Unavailable"} · effective {view.effectivePolicy?.effectiveAt ?? "Unavailable"}</p>
        <p>Official On Hold threshold: {view.effectivePolicy?.stopOnHoldValueAt ?? "Unavailable"} ({view.effectivePolicy?.stopOnHoldValueAtSource ?? "Unavailable"})</p>
        <p>Delivery threshold: {view.effectivePolicy?.stopDeliveryRateBelow ?? "Unavailable"} ({view.effectivePolicy?.stopDeliveryRateBelowSource ?? "Unavailable"})</p>
        {view.effectivePolicy === undefined ? null : <Evidence {...view.effectivePolicy} />}
        <p>Expression: {view.rule.expression}</p>
        <p>Evaluated: {view.rule.evaluatedAt}</p>
        <p>Triggers: {view.rule.triggers.join(", ") || "None"}</p>
        <Evidence {...view.rule.evidence} />
        <h4>Official On Hold condition</h4>
        <p>{view.rule.conditions.officialOnHold.state} · observed {view.rule.conditions.officialOnHold.observedValue} · threshold {view.rule.conditions.officialOnHold.threshold} · source {view.rule.conditions.officialOnHold.source ?? "Unavailable"} · at {view.rule.conditions.officialOnHold.observedAt}</p>
        <Evidence {...view.rule.conditions.officialOnHold.evidence} />
        <h4>Delivery rate condition</h4>
        <p>{view.rule.conditions.deliveryRate.state} · observed {view.rule.conditions.deliveryRate.observedValue} · threshold {view.rule.conditions.deliveryRate.threshold} · source {view.rule.conditions.deliveryRate.source ?? "Unavailable"} · at {view.rule.conditions.deliveryRate.observedAt}</p>
        <Evidence {...view.rule.conditions.deliveryRate.evidence} />
        <table>
          <caption>Rule checks</caption>
          <thead><tr><th>Metric</th><th>Observed</th><th>Threshold</th><th>Operator</th><th>Result</th><th>Reason</th></tr></thead>
          <tbody>{view.rule.checks.map((check) => <tr key={`${check.metric}-${check.threshold}`}><td>{check.metric}</td><td>{check.observed}</td><td>{check.threshold}</td><td>{check.operator}</td><td>{check.result}</td><td>{check.reason}</td></tr>)}</tbody>
        </table>
        {view.rule.checks.length === 0 ? <p>Persisted rule checks are unavailable.</p> : null}
      </section>

      <section aria-labelledby="decision-center-ai">
        <h3 id="decision-center-ai">Linked AI Decision</h3>
        <Evidence {...view.ai.evidence} />
        <dl>
          <div><dt>Status</dt><dd>{view.ai.status}</dd></div>
          <div><dt>Recommendation</dt><dd>{view.ai.recommendation}</dd></div>
          <div><dt>Risk</dt><dd>{view.ai.riskLevel}</dd></div>
          <div><dt>Confidence</dt><dd>{view.ai.confidence}</dd></div>
          <div><dt>Rule agreement</dt><dd>{view.ai.ruleAgreement}</dd></div>
          <div><dt>Human review required</dt><dd>{view.ai.humanReviewRequired}</dd></div>
          <div><dt>Provider</dt><dd>{view.ai.provider}</dd></div>
          <div><dt>Requested model</dt><dd>{view.ai.requestedModel}</dd></div>
          <div><dt>Reported model</dt><dd>{view.ai.reportedModel}</dd></div>
          <div><dt>Actual model</dt><dd>{view.ai.actualModel}</dd></div>
          <div><dt>Auth mode</dt><dd>{view.ai.authMode}</dd></div>
          <div><dt>Prompt version</dt><dd>{view.ai.promptVersion}</dd></div>
          <div><dt>Output schema</dt><dd>{view.ai.outputSchemaVersion}</dd></div>
          <div><dt>Failure code</dt><dd>{view.ai.failureCode}</dd></div>
          <div><dt>Reason</dt><dd>{view.ai.reason}</dd></div>
          <div><dt>Policy version</dt><dd>{view.ai.policyVersion}</dd></div>
        </dl>
        <p>Reason codes</p><List items={view.ai.reasonCodes} />
        <p>Supporting factors</p><List items={view.ai.supportingFactors} />
        <p>Risk factors</p><List items={view.ai.riskFactors} />
        <p>What would change the recommendation</p><List items={view.ai.whatWouldChange} />
      </section>

      <section aria-labelledby="decision-center-ba">
        <h3 id="decision-center-ba">BA decision revisions</h3>
        <Evidence {...view.ba.evidence} />
        <p>Current decision: <strong>{view.ba.current}</strong></p>
        <p>{view.ba.currentDetail}</p>
        {view.caseId !== null && view.profileNo !== null ? <LiveBaForm caseId={view.caseId} profileNo={view.profileNo} /> : <p>LIVE BA submission is unavailable because no persisted decision case was returned.</p>}
        <ol>{view.ba.history.map((entry, index) => <li key={`${entry.decidedAt}-${index}`}><time>{entry.decidedAt}</time> · {entry.decision} · {entry.reason} · {entry.actor}<p>{entry.notes}</p><Evidence {...entry.evidence} /></li>)}</ol>
        {view.ba.history.length === 0 ? <p>No persisted BA history is available.</p> : null}
      </section>

      <section aria-labelledby="decision-center-execution">
        <h3 id="decision-center-execution">Execution</h3>
        <Evidence {...view.execution.evidence} />
        <dl>
          <div><dt>Status</dt><dd>{view.execution.status}</dd></div>
          <div><dt>Requested action</dt><dd>{view.execution.requestedAction}</dd></div>
          <div><dt>Mode</dt><dd>{view.execution.mode}</dd></div>
          <div><dt>Seller Center called</dt><dd>{view.execution.sellerCenterCalled}</dd></div>
          <div><dt>Executed at</dt><dd>{view.execution.executedAt}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="decision-center-queue">
        <h3 id="decision-center-queue">Exception-only review queue</h3>
        {view.reviewQueue.length === 0 ? <p>No persisted exceptions are recorded.</p> : <ul>{view.reviewQueue.map((item) => <li key={item.profileNo}><strong>{item.displayName}</strong> · Profile {item.profileNo}<span>{item.reasons.join(" · ")}</span><Evidence {...item.evidence} /></li>)}</ul>}
      </section>
    </section>
  );
}
