import type { CSSProperties } from "react";
import { FIN_STEP_STATUS_LABEL, type FinStep } from "./fin-stepper-model";
import "./fin-stepper.css";

/** شريط عرض غير تفاعلي: لا يستدعي فعلًا ولا يقرر صلاحية المستخدم. */
export function FinStepper({
  steps,
  label,
  className = "no-print",
}: {
  steps: readonly FinStep[];
  label: string;
  className?: string;
}) {
  return (
    <ol
      className={`fin-stepper${className ? ` ${className}` : ""}`}
      aria-label={label}
      dir="rtl"
      style={{ "--fin-step-count": steps.length } as CSSProperties}
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={`fin-stepper__step is-${step.status}`}
          data-status={step.status}
          aria-current={step.status === "current" ? "step" : undefined}
        >
          <span className="fin-stepper__num" aria-hidden="true">{index + 1}</span>
          <div className="fin-stepper__body">
            <strong>{step.title}</strong>
            {step.description ? <small>{step.description}</small> : null}
            <span className="fin-stepper__state">{FIN_STEP_STATUS_LABEL[step.status]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
