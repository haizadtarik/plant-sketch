import { describe, expect, it } from "vitest";
import {
  runComputerTask,
  type ComputerResponse,
} from "../lib/computer-use/loop";

const call = (extra = {}): ComputerResponse => ({
  id: "response-1",
  status: "completed",
  output_text: "",
  output: [
    {
      type: "computer_call",
      call_id: "call-1",
      actions: [
        { type: "click", x: 20, y: 30, button: "left" },
        { type: "type", text: "hello" },
      ],
      pending_safety_checks: [],
      ...extra,
    },
  ],
});
const done: ComputerResponse = {
  id: "response-2",
  status: "completed",
  output: [],
  output_text: "Done",
};

describe("computer-use execution", () => {
  it("executes a batch in order and returns its screenshot with the matching call ID", async () => {
    const actions: string[] = [],
      requests: unknown[] = [];
    const result = await runComputerTask({
      task: "Import",
      signal: new AbortController().signal,
      respond: async (request) => {
        requests.push(request);
        return requests.length === 1 ? call() : done;
      },
      execute: async (action) => {
        actions.push(action.type);
      },
      screenshot: async () => "data:image/png;base64,AAAA",
      verify: async () => actions.length === 2,
    });
    expect(actions).toEqual(["click", "type"]);
    expect(requests[1]).toMatchObject({
      previous_response_id: "response-1",
      input: [
        {
          type: "computer_call_output",
          call_id: "call-1",
          output: { image_url: "data:image/png;base64,AAAA" },
        },
      ],
    });
    expect(result).toBe("verified");
  });
  it("does not trust a model completion when the application outcome fails verification", async () => {
    await expect(
      runComputerTask({
        task: "Import",
        signal: new AbortController().signal,
        respond: async () => done,
        execute: async () => {},
        screenshot: async () => "image",
        verify: async () => false,
      }),
    ).rejects.toThrow(/verification/i);
  });
  it("hands off pending safety checks without executing or acknowledging them", async () => {
    let executed = false;
    await expect(
      runComputerTask({
        task: "Import",
        signal: new AbortController().signal,
        respond: async () =>
          call({
            pending_safety_checks: [
              {
                id: "s1",
                code: "malicious_instructions",
                message: "Review needed",
              },
            ],
          }),
        execute: async () => {
          executed = true;
        },
        screenshot: async () => "image",
        verify: async () => true,
      }),
    ).rejects.toThrow(/Review needed/);
    expect(executed).toBe(false);
  });
  it("stops an action batch as soon as cancellation is requested", async () => {
    const abort = new AbortController(),
      actions: string[] = [];
    await expect(
      runComputerTask({
        task: "Import",
        signal: abort.signal,
        respond: async () => call(),
        execute: async (a) => {
          actions.push(a.type);
          abort.abort();
        },
        screenshot: async () => "image",
        verify: async () => true,
      }),
    ).rejects.toThrow();
    expect(actions).toEqual(["click"]);
  });
  it("bounds repeated computer calls", async () => {
    let count = 0;
    await expect(
      runComputerTask({
        task: "Import",
        signal: new AbortController().signal,
        maxTurns: 2,
        respond: async () => {
          count++;
          return call();
        },
        execute: async () => {},
        screenshot: async () => "image",
        verify: async () => false,
      }),
    ).rejects.toThrow(/limit/i);
    expect(count).toBe(2);
  });
});
