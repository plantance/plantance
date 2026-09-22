import React, { useEffect, useState } from "react";

const S = {
  wrap: { font: "16px/1.5 system-ui, sans-serif", maxWidth: 560, margin: "40px auto", padding: 16 },
  row: { display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #8883" },
  input: { flex: 1, padding: "8px 10px", border: "1px solid #8886", borderRadius: 8, font: "inherit" },
  btn: { padding: "8px 14px", border: 0, borderRadius: 8, background: "#2f6fed", color: "#fff", cursor: "pointer" },
  del: { border: 0, background: "transparent", color: "#c62828", cursor: "pointer" },
};

export function App() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/items");
      if (res.ok) setItems(await res.json());
    } catch {
      /* offline preview: no functions/DB — the page still renders */
    }
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, notes }),
    });
    setName(""); setNotes(""); load();
  }

  async function remove(id) {
    await fetch(`/api/items/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={S.wrap}>
      <h1>My Tracker</h1>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input style={S.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={S.input} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button style={S.btn} type="submit">Add</button>
      </form>
      {items.length === 0 && <p style={{ opacity: 0.6 }}>Nothing yet. Add your first item.</p>}
      {items.map((it) => (
        <div style={S.row} key={it.id}>
          <strong>{it.name}</strong>
          <span style={{ flex: 1, opacity: 0.7 }}>{it.notes}</span>
          <button style={S.del} onClick={() => remove(it.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
