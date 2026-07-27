import type { Message } from "discord.js";
import type { StreamToken } from "../llm/opencode";

const EDIT_INTERVAL_MS = 800;
const MAX_MSG_LEN = 1900;
const TS_RE = /^\[[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}\]\s*/;

export class MessageStreamer {
  private msg: Message | null = null;
  private buffer = "";
  private fullText = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  private chunkIndex = 0;
  private tsSkipped = false;
  private tsBuffer = "";

  constructor(
    private target: Message,
    private statusMsg: Message | null,
    private toolHeader: string,
  ) {}

  async stream(gen: AsyncGenerator<StreamToken>): Promise<string> {
    if (this.statusMsg) {
      await this.statusMsg.edit({ content: `${this.toolHeader} ✓` });
    }

    for await (const { token, type } of gen) {
      if (type === "reasoning") continue;

      if (!this.tsSkipped) {
        const stripped = this.stripLeadingTs(token);
        if (!stripped) continue;
        this.buffer += stripped;
        this.fullText += stripped;
      } else {
        this.buffer += token;
        this.fullText += token;
      }

      if (!this.msg) {
        if (this.buffer.length >= 5) {
          this.msg = await this.target.channel.send(this.buffer);
          this.buffer = "";
          this.scheduleFlush();
        }
        continue;
      }

      if (this.buffer.length >= 50) {
        await this.flush();
      }

      if (!this.timer) {
        this.scheduleFlush();
      }
    }

    await this.finish();
    return this.fullText;
  }

  private stripLeadingTs(token: string): string | null {
    this.tsBuffer += token;

    const match = this.tsBuffer.match(TS_RE);
    if (match) {
      const after = this.tsBuffer.slice(match[0].length);
      this.tsSkipped = true;
      this.tsBuffer = "";
      return after || null;
    }

    if (this.tsBuffer.length > 40) {
      this.tsSkipped = true;
      const result = this.tsBuffer;
      this.tsBuffer = "";
      return result;
    }

    if (/^\[[A-Za-z]/.test(this.tsBuffer) && !/^\[[A-Z][a-z]{2}\s/.test(this.tsBuffer)) {
      this.tsSkipped = true;
      const result = this.tsBuffer;
      this.tsBuffer = "";
      return result;
    }

    if (this.tsBuffer.startsWith("[") && this.tsBuffer.length >= 15) {
      this.tsSkipped = true;
      const result = this.tsBuffer;
      this.tsBuffer = "";
      return result;
    }

    return null;
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.done) return;
      await this.flush();
      if (this.buffer.length >= 10) {
        this.scheduleFlush();
      }
    }, EDIT_INTERVAL_MS);
  }

  private splitCodeblockSafe(text: string, maxLen: number): { safe: string; rest: string } {
    const backtickRun = text.slice(0, maxLen).split("```").length - 1;
    if (backtickRun % 2 === 0) {
      const splitAt = text.lastIndexOf("\n", maxLen);
      const pos = splitAt > maxLen / 2 ? splitAt : text.lastIndexOf(" ", maxLen);
      const safe = text.slice(0, pos > 0 ? pos : maxLen);
      return { safe, rest: text.slice(safe.length).trimStart() };
    }

    const closeAt = text.indexOf("```", 3);
    if (closeAt >= 0 && closeAt < maxLen) {
      const splitAt = text.lastIndexOf("\n", maxLen);
      const pos = splitAt > maxLen / 2 ? splitAt : text.lastIndexOf(" ", maxLen);
      const safe = text.slice(0, pos > 0 ? pos : maxLen);
      return { safe, rest: text.slice(safe.length).trimStart() };
    }

    const safe = text.slice(0, maxLen) + "\n```";
    const rest = "```\n" + text.slice(maxLen).trimStart();
    return { safe, rest };
  }

  private async flush(): Promise<void> {
    if (!this.msg || this.buffer.length === 0) return;

    let current = this.buffer;
    this.buffer = "";

    const snapshot = this.msg.content + current;

    if (snapshot.length <= MAX_MSG_LEN) {
      await this.msg.edit(snapshot);
      return;
    }

    const { safe, rest } = this.splitCodeblockSafe(snapshot, MAX_MSG_LEN);
    await this.msg.edit(safe);

    if (rest.length > 0) {
      this.chunkIndex++;
      this.msg = await this.target.channel.send(rest);
    }
  }

  private async finish(): Promise<void> {
    this.done = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length > 0 && this.msg) {
      const snapshot = this.msg.content + this.buffer;
      if (snapshot.length <= MAX_MSG_LEN) {
        await this.msg.edit(snapshot);
      } else {
        const { safe, rest } = this.splitCodeblockSafe(snapshot, MAX_MSG_LEN);
        await this.msg.edit(safe);
        if (rest.length > 0) {
          this.msg = await this.target.channel.send(rest);
        }
      }
      this.buffer = "";
    }

    if (!this.msg) {
      this.msg = await this.target.channel.send(this.fullText || "...");
    }
  }
}
