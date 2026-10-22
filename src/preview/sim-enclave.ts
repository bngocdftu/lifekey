// PREVIEW ONLY. The Tide enclave's approval pop-up, simulated as an in-page dialog. On the real
// network this window belongs to Tide, not to LifeKey, and the approver's key signs inside it.

import { simAccount, simReadSession } from "./sim-tide";

export function simEnclaveApprove(ids: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const who = simAccount(simReadSession()?.username);
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;background:rgba(18,33,42,.45);font-family:inherit";
    const card = document.createElement("div");
    card.style.cssText = "width:min(420px,100%);background:var(--surface);color:var(--text);border-radius:var(--radius);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25)";
    card.innerHTML = `
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Tide enclave · simulated</div>
      <h2 style="margin:6px 0 10px;font-size:20px">Approve ${ids.length === 1 ? "this change request" : `${ids.length} change requests`}?</h2>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.5">Signed as <b></b>. Your vote counts toward the 2-of-3 quorum; the policy exists only once the quorum is met.</p>
      <ul style="margin:0 0 18px;padding-left:18px;font-size:13px;color:var(--muted)"></ul>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" data-deny class="btn">Deny</button>
        <button type="button" data-ok class="btn primary">Sign</button>
      </div>`;
    card.querySelector("b")!.textContent = who ? `${who.tideUsername} (${who.username})` : "unknown";
    const list = card.querySelector("ul")!;
    for (const id of ids) {
      const li = document.createElement("li");
      li.textContent = id;
      list.appendChild(li);
    }
    const done = (ok: boolean) => {
      overlay.remove();
      resolve(ok);
    };
    card.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = () => done(true);
    card.querySelector<HTMLButtonElement>("[data-deny]")!.onclick = () => done(false);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.querySelector<HTMLButtonElement>("[data-ok]")!.focus();
  });
}
