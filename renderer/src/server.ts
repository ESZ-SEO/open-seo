import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { closeBrowser } from "./browser.js";
import { renderHtmlToPng } from "./screenshot.js";

const PORT = Number(process.env.PORT ?? 3100);
const HOST = "0.0.0.0";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }, 200));

const BodySchema = z.object({
  html: z.string().min(1, "html is required"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  waitForSelector: z.string().min(1).optional(),
  fullPage: z.boolean().optional(),
});

app.post("/screenshot", async (c) => {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await c.req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.errors
            .map((e) => `${e.path.join(".") || "body"}: ${e.message}`)
            .join("; ")
        : "Invalid JSON body";
    return c.json({ error: message }, 400);
  }

  try {
    const png = await renderHtmlToPng(body);
    return new Response(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[renderer] screenshot failed:", err);
    const message = err instanceof Error ? err.message : "Screenshot failed";
    return c.json({ error: message }, 502);
  }
});

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    console.log(`[renderer] listening on http://${HOST}:${info.port}`);
  },
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[renderer] ${signal} received, shutting down`);
  server.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
