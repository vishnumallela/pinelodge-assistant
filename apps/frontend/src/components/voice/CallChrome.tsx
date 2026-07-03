import { ShimmeringText } from "@/components/ui/shimmering-text";
import type { useVoiceAgent } from "@/hooks/useVoiceAgent";

type Agent = ReturnType<typeof useVoiceAgent>;

export function CallStatus({ agent, agentName }: { agent: Agent; agentName: string }) {
  let text: string;
  let shimmer = false;
  if (agent.status === "connecting") {
    text = `Connecting to ${agentName}…`;
    shimmer = true;
  } else if (!agent.isConnected) {
    text = "Ready when you are";
  } else if (agent.isToolRunning) {
    text = `${agentName} is working on it…`;
    shimmer = true;
  } else if (agent.isAgentSpeaking) {
    text = `${agentName} is speaking`;
    shimmer = true;
  } else if (agent.isAgentThinking) {
    text = `${agentName} is thinking…`;
    shimmer = true;
  } else if (agent.isUserSpeaking) {
    text = "Listening to you…";
  } else {
    text = "Listening, go ahead";
  }

  return (
    <>
      <output className="sr-only">{text}</output>
      {shimmer ? (
        <ShimmeringText
          text={text}
          duration={1.6}
          startOnView={false}
          className="text-xs"
          aria-hidden
        />
      ) : (
        <p className="text-xs text-muted-foreground" aria-hidden>
          {text}
        </p>
      )}
    </>
  );
}
