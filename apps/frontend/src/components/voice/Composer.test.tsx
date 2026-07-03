import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    connected: true,
    connecting: false,
    muted: false,
    canSend: true,
    placeholder: "Respond as the caller",
    onSend: vi.fn(),
    onStart: vi.fn(),
    onEnd: vi.fn(),
    onToggleMute: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe("Composer", () => {
  it("submits trimmed text on Enter and clears the field", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;

    await user.type(box, "  book me in  {Enter}");

    expect(onSend).toHaveBeenCalledExactlyOnceWith("book me in");
    expect(box.value).toBe("");
  });

  it("does not submit on Shift+Enter (newline instead)", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByLabelText("Message");

    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores whitespace-only input", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    await user.type(screen.getByLabelText("Message"), "    {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button until there is text", async () => {
    const user = userEvent.setup();
    setup();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText("Message"), "hi");
    expect(send.disabled).toBe(false);
  });

  it("cannot send while viewing a past conversation", async () => {
    const user = userEvent.setup();
    const { onSend } = setup({ canSend: false });
    await user.type(screen.getByLabelText("Message"), "hello{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a Start call control when disconnected and triggers onStart", async () => {
    const user = userEvent.setup();
    const { onStart } = setup({ connected: false, canSend: false });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start call" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("toggles mute and ends the call from the connected controls", async () => {
    const user = userEvent.setup();
    const { onToggleMute, onEnd } = setup();
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(onToggleMute).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "End call" }));
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
