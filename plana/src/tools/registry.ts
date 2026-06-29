import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ReminderStore } from "../reminders/store";
import type { TaskStore } from "../tasks/store";
import type { MemoryStore } from "../memory/store";
import type { LoreStore } from "../lore/store";

export const PROACTIVE_ALLOWED_TOOLS = new Set([
  "get_current_time",
  "list_tasks",
  "daily_tasks",
  "list_reminders",
  "recall_knowledge",
  "web_search",
]);
import {
  createReminderTools,
  createWebSearchTool,
  createTaskTools,
  createMemoryTools,
} from "./handlers";

export interface ToolContext {
  guildId: string;
  channelId: string;
  userId: string;
  defaultTimezone: string;
}

export interface ToolRegistry {
  definitions: ChatCompletionTool[];
  dispatch(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string>;
}

export function createToolRegistry(
  reminderStore: ReminderStore,
  taskStore: TaskStore,
  memoryStore: MemoryStore,
  loreStore: LoreStore,
  tavilyApiKey?: string,
  opencodeConfig?: { baseUrl: string; apiKey: string },
): ToolRegistry {
  const reminderTools = createReminderTools(reminderStore);
  const taskTools = createTaskTools(taskStore);
  const memoryTools = createMemoryTools(
    memoryStore,
    loreStore,
    opencodeConfig?.baseUrl ?? "",
    opencodeConfig?.apiKey ?? "",
  );
  const webSearch = tavilyApiKey ? createWebSearchTool(tavilyApiKey) : null;

  const definitions: ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_current_time",
        description:
          "Get the current date and time. Use this when Sensei asks what time it is, references time, or you need to know the current time to calculate future times.",
        parameters: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description:
                "Timezone, e.g. 'Asia/Jakarta'. Defaults to the configured server timezone.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_reminder",
        description:
          "Create a reminder for Sensei. Use when Sensei asks to be reminded about something at a specific time.\n\n" +
          "TIME FORMAT: Use natural language like 'in 30 minutes', 'tomorrow 9am', 'next Monday 3pm', or ISO 8601.\n\n" +
          "RECURRENCE (optional): 'daily', 'weekly', 'monthly', 'weekday' (Mon-Fri), 'weekend' (Sat-Sun), 'weekly:mon,wed,fri' for specific days, 'monthly:1,15' for specific dates.",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "What to remind about.",
            },
            when: {
              type: "string",
              description:
                "When to remind. Natural language like 'in 30 minutes', 'tomorrow 9am', or ISO 8601.",
            },
            recurrence: {
              type: "string",
              description:
                "Recurrence pattern. 'daily', 'weekly', 'monthly', 'weekday', 'weekend', 'weekly:mon,wed', 'monthly:1,15'. Omit for one-time reminders.",
            },
          },
          required: ["message", "when"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_reminder",
        description:
          "Edit an existing reminder. Use when Sensei wants to change the time or message of a reminder.",
        parameters: {
          type: "object",
          properties: {
            reminder_id: {
              type: "number",
              description: "ID of the reminder to edit.",
            },
            message: {
              type: "string",
              description: "New reminder message (optional).",
            },
            when: {
              type: "string",
              description:
                "New time (optional). Natural language or ISO 8601.",
            },
          },
          required: ["reminder_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_reminder",
        description:
          "Delete/cancel a reminder. Use when Sensei wants to cancel a reminder they no longer need.",
        parameters: {
          type: "object",
          properties: {
            reminder_id: {
              type: "number",
              description: "ID of the reminder to delete.",
            },
          },
          required: ["reminder_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_reminders",
        description:
          "List all active reminders for this channel. Use when Sensei asks what reminders they have set.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_task",
        description:
          "Add a new task to Sensei's backlog. Use when Sensei wants to track something they need to do.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short task description." },
            priority: {
              type: "string",
              description: "Priority level: low, medium, high, critical. Defaults to medium.",
            },
            category: {
              type: "string",
              description: "Category: Work, Personal, Academy, Health, Other. Defaults to Other.",
            },
            notes: { type: "string", description: "Optional detail or context." },
            deadline: {
              type: "string",
              description: "Optional due date in ISO 8601 or natural language like 'tomorrow 5pm'.",
            },
          },
          required: ["title"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_tasks",
        description:
          "List Sensei's tasks. Use when Sensei asks about their tasks, backlog, or what they need to do. Supports optional filters.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", description: "Filter by status: backlog, ready, in-progress, done." },
            priority: { type: "string", description: "Filter by priority: low, medium, high, critical." },
            category: { type: "string", description: "Filter by category." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "move_task",
        description:
          "Move a task between statuses: backlog → ready → in-progress → done. Use when Sensei wants to update task progress.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "number", description: "Task ID to move." },
            status: { type: "string", description: "New status: backlog, ready, in-progress, done." },
          },
          required: ["task_id", "status"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_task",
        description: "Edit an existing task. Use when Sensei wants to change a task's details.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "number", description: "Task ID to edit." },
            title: { type: "string", description: "New title." },
            priority: { type: "string", description: "New priority." },
            category: { type: "string", description: "New category." },
            notes: { type: "string", description: "New notes." },
            deadline: { type: "string", description: "New deadline." },
          },
          required: ["task_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_task",
        description: "Delete a task entirely. Use when Sensei wants to remove a task.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "number", description: "Task ID to delete." },
          },
          required: ["task_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sprint_tasks",
        description:
          "View the current sprint, or set sprint tasks. Call without args to view, or with task_ids to set the sprint focus.",
        parameters: {
          type: "object",
          properties: {
            task_ids: {
              type: "array",
              items: { type: "number" },
              description: "Optional: list of task IDs to focus on in this sprint.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "archive_tasks",
        description: "Archive all completed (done) tasks for record-keeping.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "daily_tasks",
        description:
          "Show a morning digest — backlog summary, ready tasks, in-progress tasks, and upcoming deadlines.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "recall_knowledge",
        description:
          "Search ALL stored knowledge — personal memories about Sensei, known facts, and Blue Archive lore about Kivotos. Use this whenever Sensei asks about past conversations, references something you should know, mentions a Kivotos character or academy, or you need context about who Sensei is and their world.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "What to search for across all knowledge stores.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_fact",
        description:
          "Save a fact about Sensei. Use whenever Sensei shares something personal, discusses preferences, mentions projects, reveals traits, celebrates achievements, or you learn something meaningful. Be proactive — if it could matter later, save it now.",
        parameters: {
          type: "object",
          properties: {
            fact: {
              type: "string",
              description: "The fact to remember about Sensei, as a clear sentence.",
            },
          },
          required: ["fact"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "save_memory",
        description:
          "Save an important moment or realization to your personal memory. Use when Sensei shares feelings, reveals something personal, celebrates, learns something significant, or says something you want to remember. The memory will be available in your summaries and retrievable later.\n\nBe selective — save what truly matters, not every exchange.\n\nTIER guidance:\n- daily: routine but noteworthy moments\n- weekly: meaningful events or realizations this week\n- monthly: significant milestones or developments\n- lifetime: core truths about Sensei's identity that won't change",
        parameters: {
          type: "object",
          properties: {
            memory: {
              type: "string",
              description: "What to remember, written as one or two sentences.",
            },
            tier: {
              type: "string",
              description: "Memory tier: daily, weekly, monthly, or lifetime. Default: daily.",
            },
          },
          required: ["memory"],
        },
      },
    },
  ];

  if (webSearch) {
    definitions.push({
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for information. Use this when Sensei asks about recent events, facts, news, or anything you don't know. Useful for looking up current information, definitions, or real-world knowledge outside your Kivotos understanding.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "What to search for. Be specific.",
            },
          },
          required: ["query"],
        },
      },
    });
  }

  async function dispatch(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    switch (toolName) {
      case "get_current_time":
        return getCurrentTime(
          (args.timezone as string) ?? ctx.defaultTimezone,
        );

      case "create_reminder":
        return reminderTools.create(ctx, args);
      case "edit_reminder":
        return reminderTools.edit(ctx, args);
      case "delete_reminder":
        return reminderTools.remove(ctx, args);
      case "list_reminders":
        return reminderTools.list(ctx);

      case "add_task":
        return taskTools.add(ctx, args);
      case "list_tasks":
        return taskTools.list(ctx, args);
      case "move_task":
        return taskTools.move(ctx, args);
      case "edit_task":
        return taskTools.edit(ctx, args);
      case "delete_task":
        return taskTools.remove(ctx, args);
      case "sprint_tasks":
        if ((args.task_ids as unknown[])?.length) {
          return taskTools.sprintSet(ctx, args);
        }
        return taskTools.sprint(ctx, args);
      case "archive_tasks":
        return taskTools.archive(ctx);
      case "daily_tasks":
        return taskTools.daily(ctx);

      case "recall_knowledge":
        return memoryTools.recallKnowledge(ctx, args);
      case "add_fact":
        return memoryTools.addFact(ctx, args);
      case "save_memory":
        return memoryTools.saveMemory(ctx, args);

      case "web_search":
        if (!webSearch) return "Error: web search is not configured.";
        return webSearch(args);

      default:
        return `Unknown tool: ${toolName}`;
    }
  }

  return { definitions, dispatch };
}

function getCurrentTime(timezone: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  };
  return `Current time in ${timezone}: ${now.toLocaleString("en-US", options)}`;
}
