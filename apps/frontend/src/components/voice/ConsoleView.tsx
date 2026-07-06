import { VoiceOrb, type OrbState } from "@/components/voice/VoiceOrb";
import { CallStatus } from "@/components/voice/CallChrome";
import { SuggestionChips } from "@/components/voice/SuggestionChips";
import { TranscriptPanel } from "@/components/voice/TranscriptPanel";
import { Composer } from "@/components/voice/Composer";
import { useCallSession } from "@/lib/call-session";

/** The live call: the caller speaks, Sarah answers, turns stream in. */
export function ConsoleView() {
  const { agent, agentName, callerPrompts, feed, endCall, send } = useCallSession();

  const orbState: OrbState = agent.isConnected
    ? agent.isAgentSpeaking
      ? "speaking"
      : agent.isAgentThinking
        ? "thinking"
        : "listening"
    : "idle";

  return (
    <main className="flex min-h-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {feed.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4">
            <VoiceOrb state={orbState} size="lg" />
            <div className="text-center">
              <p className="font-display text-[26px] leading-tight text-foreground">
                {agent.status === "connecting" ? "Connecting…" : `${agentName} is on the line`}
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Speak, or send a line to get started.
              </p>
            </div>
          </div>
        ) : (
          <TranscriptPanel
            className="min-h-0 flex-1"
            items={feed}
            agentName={agentName}
            speaking={agent.isAgentSpeaking}
            thinking={agent.isAgentThinking}
          />
        )}

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
              {agent.isConnected && feed.length === 0 && (
                <div className="mb-3">
                  <SuggestionChips prompts={callerPrompts} onPick={send} />
                </div>
              )}
              <Composer
                connected={agent.isConnected}
                connecting={agent.status === "connecting"}
                muted={agent.isMuted}
                canSend={agent.isConnected}
                onSend={send}
                onStart={() => undefined}
                onEnd={endCall}
                onToggleMute={agent.toggleMute}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
