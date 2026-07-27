// Adapter that lets the Anthropic-shaped classifier talk to any OpenAI-compatible
// endpoint (Groq, OpenRouter, Cerebras, ...). It exposes the same
// `messages.create(params)` surface the code already uses, translating the
// Anthropic tool-use request/response to/from the OpenAI chat-completions +
// function-calling shape. Used only when a free-provider key is configured
// (see src/lib/anthropic.ts); the real Claude path is untouched.

export interface OpenAICompatConfig {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeOpenAICompatClient(cfg: OpenAICompatConfig) {
  const maxRetries = 6;
  return {
    messages: {
      create: async (params: any) => {
        // Anthropic `system` + `messages` -> OpenAI messages array.
        const messages: any[] = [];
        if (params.system) messages.push({ role: "system", content: params.system });
        for (const m of params.messages ?? []) {
          messages.push({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          });
        }

        const body: any = {
          model: params.model,
          max_tokens: params.max_tokens ?? 1024,
          messages,
        };

        // Anthropic tools ({name, description, input_schema}) -> OpenAI functions.
        if (params.tools?.length) {
          body.tools = params.tools.map((t: any) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          }));
          body.tool_choice =
            params.tool_choice?.type === "tool"
              ? { type: "function", function: { name: params.tool_choice.name } }
              : "auto";
        }

        // Retry on rate limits (429) and transient 5xx, honoring the provider's
        // Retry-After header when present. Free tiers (e.g. Groq's 12k tokens/min)
        // will 429 under a burst, so this paces the eval instead of failing.
        let resp: Response;
        let attempt = 0;
        for (;;) {
          resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
          });

          const retryable = resp.status === 429 || resp.status >= 500;
          if (!retryable || attempt >= maxRetries) break;

          const retryAfter = Number(resp.headers.get("retry-after"));
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** attempt * 1000;
          await sleep(waitMs + 300); // small buffer past the reset
          attempt++;
        }

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 300)}`);
        }

        const data: any = await resp.json();
        const choice = data.choices?.[0];
        const toolCall = choice?.message?.tool_calls?.[0];

        // Return an Anthropic-shaped response so callers parse it unchanged.
        if (toolCall) {
          let input: any = {};
          try {
            input = JSON.parse(toolCall.function.arguments);
          } catch {
            input = {};
          }
          return {
            id: data.id ?? "oai",
            type: "message",
            role: "assistant",
            model: data.model,
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: toolCall.id ?? "call", name: toolCall.function.name, input },
            ],
            usage: {},
          };
        }

        // No tool call — hand back text so callers fall back gracefully.
        return {
          id: data.id ?? "oai",
          type: "message",
          role: "assistant",
          model: data.model,
          stop_reason: "end_turn",
          content: [{ type: "text", text: choice?.message?.content ?? "" }],
          usage: {},
        };
      },
    },
  };
}
