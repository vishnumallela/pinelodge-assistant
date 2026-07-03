import { Link } from "@tanstack/react-router";
import { useCallSession } from "@/lib/call-session";
import { VoiceOrb, type OrbState } from "@/components/voice/VoiceOrb";
import { CallStatus } from "@/components/voice/CallChrome";
import { SuggestionChips } from "@/components/voice/SuggestionChips";
import { TranscriptPanel } from "@/components/voice/TranscriptPanel";
import { CallStatePanel } from "@/components/voice/CallStatePanel";
import { Composer } from "@/components/voice/Composer";
import { FACILITY_NAME } from "@/lib/config";

export function HomePage() {
  const { agent, agentName, callerPrompts, liveCall, lastCallId, startCall, endCall, send } =
    useCallSession();

  const messages = agent.history
    .filter((h) => h.status === "completed" && h.text.trim() !== "")
    .map((h) => ({ id: h.id, role: h.role, text: h.text }));
  const inCall = agent.isConnected || agent.status === "connecting";
  const empty = messages.length === 0;

  const orbState: OrbState = agent.isConnected
    ? agent.isAgentSpeaking
      ? "speaking"
      : agent.isAgentThinking
        ? "thinking"
        : "listening"
    : "idle";

  const composer = (
    <Composer
      connected={agent.isConnected}
      connecting={agent.status === "connecting"}
      muted={agent.isMuted}
      canSend={agent.isConnected}
      onSend={send}
      onStart={startCall}
      onEnd={endCall}
      onToggleMute={agent.toggleMute}
    />
  );

  if (!inCall && empty) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
        <VoiceOrb state={orbState} size="lg" />
        <div className="space-y-2 text-center">
          <h1 className="font-display text-balance text-[40px] font-normal leading-[1.1] tracking-normal text-foreground">
            Incoming call console
          </h1>
          <p className="mx-auto max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground">
            Start a simulated call to {FACILITY_NAME}. You are the caller; {agentName} answers,
            gathers what the front desk needs, and routes the call.
          </p>
        </div>
        <div className="w-full max-w-3xl px-4 md:px-5">
          {composer}
          {lastCallId && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Call saved.{" "}
              <Link
                to="/calls/$callId"
                params={{ callId: lastCallId }}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                View the call report
              </Link>
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <TranscriptPanel
          className="min-h-0 flex-1"
          messages={messages}
          thinking={agent.isAgentThinking || agent.isAgentSpeaking}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="h-16 bg-linear-to-t from-background to-transparent" />
          <div className="pointer-events-auto bg-background px-4 pb-5 md:px-5">
            <div className="mx-auto w-full max-w-3xl">
              {agent.isConnected && (
                <div className="mb-3 flex items-center justify-center gap-2.5">
                  <VoiceOrb state={orbState} size="sm" />
                  <CallStatus agent={agent} agentName={agentName} />
                </div>
              )}
              {agent.isConnected && messages.length === 0 && (
                <div className="mb-3">
                  <SuggestionChips prompts={callerPrompts} onPick={send} />
                </div>
              )}
              {inCall ? (
                composer
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  This call has ended.{" "}
                  {lastCallId && (
                    <Link
                      to="/calls/$callId"
                      params={{ callId: lastCallId }}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      View the call report
                    </Link>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {liveCall && <div className="hidden xl:flex">{<CallStatePanel call={liveCall} />}</div>}
    </main>
  );
}
