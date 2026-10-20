"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importBatch } from "@/app/actions";
import { mergeExport } from "@/lib/letterboxd";
import { unzipText } from "@/lib/unzip";

const BATCH = 20;
// Only the top-level files; the zip also has deleted/, likes/, lists/ folders.
const WANTED = /^(watched|ratings|watchlist)\.csv$/i;

export function ImportForm({ name }: { name: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(files: FileList) {
    setBusy(true);
    setMissed([]);
    try {
      const texts: { name: string; text: string }[] = [];
      for (const f of Array.from(files)) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          texts.push(...(await unzipText(await f.arrayBuffer(), (n) => WANTED.test(n))));
        } else texts.push({ name: f.name, text: await f.text() });
      }
      const films = mergeExport(texts);
      if (!films.length) {
        setStatus("No films found. Pick the Letterboxd export .zip (or watched.csv / ratings.csv).");
        return;
      }
      const all: string[] = [];
      let matched = 0;
      for (let i = 0; i < films.length; i += BATCH) {
        setProgress({ done: i, total: films.length });
        const res = await importBatch(films.slice(i, i + BATCH));
        matched += res.matched;
        all.push(...res.missed);
      }
      setProgress({ done: films.length, total: films.length });
      setMissed(all);
      setStatus(`Done: ${matched} of ${films.length} films imported for ${name}.`);
      router.refresh();
    } catch (err) {
      setStatus(`Import stopped: ${String((err as Error)?.message ?? err)}. Already-imported films are kept; run it again to finish.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className={`btn-primary w-full ${busy ? "opacity-50" : ""}`}>
        {busy ? "Importing…" : `Choose ${name}'s Letterboxd export`}
        <input
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          multiple
          disabled={busy}
          className="hidden"
          onChange={(e) => e.target.files?.length && run(e.target.files)}
        />
      </label>
      {progress && (
        <div className="h-2 overflow-hidden rounded bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
      {status && <p className="text-sm">{status}</p>}
      {missed.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary>{missed.length} not found on TMDB (you can swipe or search these later)</summary>
          <p className="mt-1">{missed.join(" · ")}</p>
        </details>
      )}
    </div>
  );
}
