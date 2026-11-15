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
      <Row id="docs" title="Write with the whole team in the room." body="Cursors, comments and edits show up as they happen. Type a slash for blocks, tables and code."
        points={["Live cursors with names, in a color that stays theirs", "Comments tied to the exact words they are about", "Tables, checklists and code blocks from the slash menu"]}>
        <DocDemo />
      </Row>
      <Row flip id="sheets" title="Numbers that explain themselves." body="Formulas and shared selections. When someone changes a cell, everyone sees the total move."
        points={["26 columns by 100 rows of raw cell text, no formatting", "A formula bar that shows what each cell is doing", "Collaborator selections in their own color"]}>
        <SheetDemo />
      </Row>
      <Row id="canvas" title="Sketch the system before you write it down." body="A canvas preview next to your docs. It runs on sample data with simulated collaborators and is not saved or shared yet."
        points={["Shapes, arrows and free drawing (Excalidraw)", "Preview: sample data, no backend", "Not yet a live shared canvas"]}>
        <CanvasDemo />
      </Row>
      <Row flip id="council" title="Ask several minds at once." body="Run several model seats on a brief. They draft, critique each other and one writes the result to AGENTS.md and ARCHITECTURE.md files (and PRD.md when the writing model includes it) in a folder you choose."
        points={["Seats are providers you configure (Anthropic, OpenAI, Google, OpenAI-compatible)", "Per-run token and cost caps, with progress and spend shown", "Output is saved as files; the example on the left is illustrative"]}>
        <CouncilDemo />
      </Row>
    </>
  );
}
