/**
 * OpenRouter Chat Completions responses recorded on 2026-11-26 while preparing issue #448, with
 * every generation id, call id, key and user identifier replaced by synthetic values. Company
 * names in `provider` are the public names OpenRouter reported.
 */
export const generation = "gen-0000000000-SyntheticGeneration1";
const base = {
  id: generation,
  object: "chat.completion.chunk",
  created: 1_700_000_000,
  model: "moonshotai/kimi-k3.1-pro",
  provider: "InferenceNet",
};
type Chunk = Record<string, unknown>;
export function chunk(delta: Chunk, finish: string | null = null, extra: Chunk = {}): Chunk {
  return {
    ...base,
    choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish }],
    ...extra,
  };
}
export function usage(finish: string, counts: Chunk = {}): Chunk {
  return chunk({ content: "", role: "assistant" }, finish, {
    service_tier: "priority",
    usage: {
      prompt_tokens: 217,
      completion_tokens: 78,
      total_tokens: 295,
      cost: 0.0016389,
      is_byok: false,
      prompt_tokens_details: {
        cached_tokens: 12,
        cache_write_tokens: 0,
        audio_tokens: 0,
        video_tokens: 0,
      },
      cost_details: {
        upstream_inference_cost: 0.0016389,
        upstream_inference_prompt_cost: 0.0005859,
        upstream_inference_completions_cost: 0.001053,
      },
      completion_tokens_details: { reasoning_tokens: 33, image_tokens: 0, audio_tokens: 0 },
      ...counts,
    },
  });
}
const reasoning = (text: string) =>
  chunk({
    content: "",
    role: "assistant",
    reasoning: text,
    reasoning_details: [{ type: "reasoning.text", text, format: "unknown", index: 0 }],
  });
/** A reply with text, as the first run streamed it. */
export const textReply: (Chunk | string)[] = [
  ": OPENROUTER PROCESSING",
  reasoning("I need to answer briefly."),
  chunk({ content: "Synthetic ", role: "assistant" }),
  chunk({ content: "reply.", role: "assistant" }),
  chunk({ content: "", role: "assistant", reasoning: null }, "stop"),
  usage("stop"),
  "[DONE]",
];
/** A tool call whose arguments came in one fragment after an empty one (run 1). */
export const toolReplyOneFragment: (Chunk | string)[] = [
  reasoning("I'll call the tool only."),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: "call_synthetic0000000000000001",
        type: "function",
        function: { name: "ohtia_record_note", arguments: "" },
      },
    ],
  }),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [{ index: 0, function: { arguments: "" } }],
  }),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [{ index: 0, function: { arguments: '{"note": "probe ok"}' } }],
  }),
  chunk({ content: "", role: "assistant", reasoning: null }, "tool_calls"),
  usage("tool_calls"),
  "[DONE]",
];
/** The same call in three fragments from another company (run 2). */
export const toolReplyThreeFragments: (Chunk | string)[] = [
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: "chatcmpl-tool-synthetic00000002",
        type: "function",
        function: { name: "ohtia_record_note", arguments: "" },
      },
    ],
  }),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [{ index: 0, function: { arguments: "{" } }],
  }),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [{ index: 0, function: { arguments: '"note": "probe ok' } }],
  }),
  chunk({
    content: null,
    role: "assistant",
    tool_calls: [{ index: 0, function: { arguments: '"}' } }],
  }),
  chunk({ content: "", role: "assistant", reasoning: null }, "tool_calls"),
  usage("tool_calls"),
  "[DONE]",
].map((item) => (typeof item === "string" ? item : { ...item, provider: "Pareto Inference" }));
/** Error bodies OpenRouter returned before any stream, with synthetic identifiers. */
export const errorBodies = {
  guardrail: {
    error: {
      message:
        "0 endpoints out of 2 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons):\nModel blocked by guardrail: 2 endpoints excluded; configurable at https://openrouter.ai/workspaces/synthetic/guardrails",
      code: 404,
      metadata: { input_endpoint_count: 2, ineligibility_reasons: ["guardrail"] },
    },
    user_id: "user_synthetic",
  },
  terms: {
    error: {
      message: "The request is prohibited due to a violation of provider Terms Of Service.",
      code: 403,
    },
    user_id: "user_synthetic",
  },
  context: {
    error: {
      message:
        "This endpoint's maximum context length is 1048576 tokens. However, you requested about 1200000 tokens.",
      code: 400,
    },
    user_id: "user_synthetic",
  },
  rejectedKey: { error: { message: "User not found.", code: 401 } },
} as const;
