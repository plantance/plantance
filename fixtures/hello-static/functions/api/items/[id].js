// Cloudflare Pages Function: /api/items/:id  (DELETE + PUT)
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function onRequestDelete({ params, env }) {
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}

export async function onRequestPut({ params, request, env }) {
  const { name, notes } = await request.json();
  await env.DB.prepare("UPDATE items SET name = ?, notes = ? WHERE id = ?")
    .bind(String(name), String(notes ?? ""), params.id)
    .run();
  return json({ ok: true });
}
