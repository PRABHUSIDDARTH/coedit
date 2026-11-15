"use client";

import { FileText, Sparkles, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useMe } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useCreateWorkspace } from "@/api/workspaces";
import { NameDialog } from "@/components/app/dialogs";
import { fileHref, KIND_ICON, useFileActions } from "@/components/app/file-tree";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { timeAgo } from "@/lib/utils";
import { useUi } from "@/stores/ui";

export default function AppHome() {
  usePageMeta({ title: "Home", peers: [] });
  const router = useRouter();
  const me = useMe();
  const { workspaces, current, tree } = useCurrentWorkspace();
  const setWorkspaceId = useUi((s) => s.setWorkspaceId);
  const create = useCreateWorkspace();
  const [naming, setNaming] = useState(false);
  const { actions, inputs } = useFileActions(current?.id ?? "", tree.data);

  const makeWorkspace = (name: string) => {
    setNaming(false);
    create.mutate(name, { onSuccess: (w) => { setWorkspaceId(w.id); toast.success(`Created ${w.name}`); }, onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't create the workspace") });
  };

  if (workspaces.isError) return <ErrorState title="Your workspaces didn't load" error={workspaces.error} onRetry={() => workspaces.refetch()} />;
  if (workspaces.isSuccess && !current) {
    return (
      <>
        <EmptyState icon={FileText} className="py-24" title="Create your first workspace" body="A workspace holds your docs, sheets and files, and the people you work with." action={<Button onClick={() => setNaming(true)}>Create workspace</Button>} />
        {naming && <NameDialog title="New workspace" label="Name" confirm="Create workspace" onSubmit={makeWorkspace} onClose={() => setNaming(false)} />}
      </>
    );
  }

  const quick = [
    { icon: FileText, title: "New doc", hint: "Write with live cursors", run: () => actions.newFile("doc", null), edit: true },
    { icon: Table2, title: "New sheet", hint: "Formulas that update for everyone", run: () => actions.newFile("sheet", null), edit: true },
    { icon: Upload, title: "Upload a file", hint: "Keep versions of any file up to 50 MB", run: () => actions.pickUpload(null), edit: true },
    { icon: Sparkles, title: "Ask the Council", hint: "Turn a brief into a handoff pack", run: () => router.push("/app/council"), edit: false },
  ].filter((q) => !q.edit || actions.editable);
  const files = [...(tree.data?.files ?? [])].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));

  return (
    <div className="page-x py-10">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">{me.data ? `Welcome back, ${me.data.display_name.split(" ")[0]}` : "Welcome back"}</h2>
      <p className="mt-1 text-sm text-ink-2">{current ? `You're in ${current.name} as ${current.role}.` : "Loading your workspace."}</p>

      <div className="mt-8 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {quick.map((q) => (
          <button key={q.title} type="button" onClick={q.run} className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3 text-left transition-colors hover:border-azure">
            <q.icon className="size-5 shrink-0 text-azure" aria-hidden />
            <span><span className="block text-sm font-medium text-ink">{q.title}</span><span className="block text-xs text-ink-3">{q.hint}</span></span>
          </button>
        ))}
      </div>

      <section className="mt-12" aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-2 px-3 text-xs font-medium text-ink-3">Recently changed</h2>
        {(workspaces.isPending || tree.isPending) && current !== undefined || workspaces.isPending ? <ListSkeleton rows={6} /> : null}
        {tree.isError && <ErrorState title="Your files didn't load" error={tree.error} onRetry={() => tree.refetch()} />}
        {tree.data && files.length === 0 && <EmptyState icon={FileText} title="No files yet" body={actions.editable ? "Create a doc or sheet, upload a file, or import a Markdown or CSV file." : "Nothing has been shared in this workspace yet."} />}
        {files.length > 0 && (
          <ul>{files.map((f) => {
            const Icon = KIND_ICON[f.kind];
            return (
              <li key={f.id}><Link href={fileHref(f)} className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-raised">
                <span className="flex min-w-0 items-center gap-3"><Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate text-sm font-medium text-ink">{f.name}</span></span>
                <span className="text-right text-sm text-ink-3">{timeAgo(f.updated_at)}</span>
              </Link></li>
            );
          })}</ul>
        )}
      </section>
      {inputs}
    </div>
  );
}
