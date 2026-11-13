import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";

type TaskAction = { key: string; tone: string; icon: AppIconName; text: string; href: string };
type Lane = { id: string; title: string; keys: string[] };

const LANES: Lane[] = [
  { id: "settlements", title: "العهد والتسويات", keys: ["blocked", "stale", "open", "settle"] },
  { id: "expenses", title: "المصروفات", keys: ["pending", "approved", "approve", "pay"] },
  { id: "follow-up", title: "متابعة أخرى", keys: ["outstanding"] },
];

export default function DashboardTaskBoard({ actions }: { actions: TaskAction[] }) {
  const lanes = LANES.map((lane) => ({ ...lane, items: actions.filter((action) => lane.keys.includes(action.key)) }));
  const other = actions.filter((action) => !LANES.some((lane) => lane.keys.includes(action.key)));
  if (other.length) lanes[2].items.push(...other);

  return (
    <div className="dashboard-task-board" aria-label="لوحة مهام الإجراءات المعلقة">
      {lanes.map((lane) => (
        <section className="dashboard-task-board__lane" key={lane.id} aria-labelledby={`task-lane-${lane.id}`}>
          <header className="dashboard-task-board__lane-head">
            <h4 id={`task-lane-${lane.id}`}>{lane.title}</h4>
            <span aria-label={`${lane.items.length} إجراء`}>{lane.items.length}</span>
          </header>
          <div className="dashboard-task-board__cards">
            {lane.items.length ? lane.items.map((item) => (
              <Link className="dashboard-task-board__card" key={item.key} href={item.href}>
                <span className={`dashboard-task-board__icon${item.tone === "warning" ? " is-warning" : ""}`} aria-hidden="true">
                  <AppIcon name={item.icon} />
                </span>
                <span>{item.text}</span>
                <AppIcon className="dashboard-task-board__arrow" name="arrow" aria-hidden="true" />
              </Link>
            )) : <p className="dashboard-task-board__empty">لا توجد إجراءات معلّقة في هذا المسار.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
