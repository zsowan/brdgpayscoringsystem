export interface FlowStep {
  label: string;
  detail?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

export function DecisionFlowVisualization({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flow-viz">
      {steps.map((step, idx) => (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className={`flow-step flow-step-${step.tone ?? 'neutral'}`}>
            <div>{step.label}</div>
            {step.detail && <div className="flow-step-detail">{step.detail}</div>}
          </div>
          {idx < steps.length - 1 && <div className="flow-arrow">↓</div>}
        </div>
      ))}
    </div>
  );
}
