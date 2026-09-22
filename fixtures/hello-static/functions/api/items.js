// Cloudflare Pages Function: /api/items  (D1 binding is `DB`)
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, notes FROM items ORDER BY id DESC",
  ).all();
  return json(results ?? []);
}

export async function onRequestPost({ request, env }) {
  const { name, notes } = await request.json();
  if (!name || !String(name).trim()) return json({ error: "name required" }, 400);
  await env.DB.prepare("INSERT INTO items (name, notes) VALUES (?, ?)")
    .bind(String(name), String(notes ?? ""))
    .run();
  return json({ ok: true }, 201);
}
