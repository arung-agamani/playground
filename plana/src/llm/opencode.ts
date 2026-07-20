import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export interface LlmCallOptions {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  maxToolIterations?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallResult {
  content: string | null;
  messages: ChatCompletionMessageParam[];
  finishReason: string;
}

export function createOpenCodeClient(baseUrl: string, apiKey: string) {
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
    timeout: 120_000,
  });

  async function chat(options: LlmCallOptions): Promise<LlmCallResult> {
    const { model, messages, tools, maxToolIterations = 3, temperature, maxTokens } = options;
    const allMessages = [...messages];
    let iterations = 0;

    while (iterations < maxToolIterations) {
      iterations++;

      const response = await client.chat.completions.create({
        model,
        messages: allMessages,
        tools: tools?.length ? tools : undefined,
        tool_choice: tools?.length ? "auto" : "none",
        max_tokens: maxTokens ?? 4000,
        ...(temperature !== undefined ? { temperature } : {}),
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No response from LLM");
      }

      const finishReason = choice.finish_reason;
      const message = choice.message;

      if (finishReason === "tool_calls" && message.tool_calls?.length) {
        allMessages.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });

        return {
          content: null,
          messages: allMessages,
          finishReason,
        };
      }

      allMessages.push({
        role: "assistant",
        content: message.content,
      });

      return {
        content: message.content,
        messages: allMessages,
        finishReason,
      };
    }

    return {
      content: null,
      messages: allMessages,
      finishReason: "max_iterations",
    };
  }

  return { chat };
}
