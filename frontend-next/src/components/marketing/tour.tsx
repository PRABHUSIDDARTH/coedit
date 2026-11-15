import { CanvasDemo, CouncilDemo, DocDemo, SheetDemo } from "./demos";
import { cn } from "@/lib/utils";

function Row({ id, title, body, points, flip, children }: { id: string; title: string; body: string; points: string[]; flip?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 border-b border-border py-20 sm:py-28">
      <div className="grid items-center gap-10 page-x lg:grid-cols-12 lg:gap-16">
        <div className={cn("lg:col-span-5", flip && "lg:order-2")}>
          <h2 id={`${id}-h`} className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">{title}</h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-2">{body}</p>
          <ul className="mt-6 space-y-2.5 text-sm text-ink-2">
            {points.map((p) => (
              <li key={p} className="flex gap-3"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-azure" />{p}</li>
            ))}
          </ul>
        </div>
        <div className={cn("lg:col-span-7", flip && "lg:order-1")}>{children}</div>
      </div>
    </section>
  );
}

export function Tour() {
  return (
    <>
      <Row id="docs" title="Write with the whole team in the room." body="Cursors, comments and edits show up as they happen. Type a slash for blocks, tables and code, and ask the Council for a second opinion without leaving the page."
        points={["Live cursors with names, in a color that stays theirs", "Comments tied to the exact words they are about", "Tables, checklists and code blocks from the slash menu"]}>
        <DocDemo />
      </Row>
      <Row flip id="sheets" title="Numbers that explain themselves." body="Formulas, typed columns and shared selections. When someone changes a cell, everyone sees the total move."
        points={["Currency, percent, date and status columns", "A formula bar that shows what each cell is doing", "Collaborator selections in their own color"]}>
        <SheetDemo />
      </Row>
      <Row id="canvas" title="Sketch the system before you write it down." body="A canvas next to your docs, with the same people and the same cursors. Draw the flow, then link it from the brief."
        points={["Shapes, arrows and free drawing", "Everyone's pointer visible, never in your way", "Lives in the same workspace as your docs and sheets"]}>
        <CanvasDemo />
      </Row>
      <Row flip id="council" title="Ask several minds at once." body="Pick three to six seats, each with a role. They discuss in turn, then the Council hands back one answer you can insert straight into your doc."
        points={["Seats like Analyst, Critic and Writer, each with their own color", "Watch the discussion as it happens", "One synthesized answer with where the seats agreed and split"]}>
        <CouncilDemo />
      </Row>
    </>
  );
}
