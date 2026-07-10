import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
  toPlainText,
} from "@react-email/components";
import type { CSSProperties } from "react";
import type { CallSummary } from "../schema";

/**
 * The transfer brief: emailed to a staff member the moment Sarah hands a live
 * caller to them, so they pick up already knowing what the call is about.
 * Preview during development with `bun run email:preview`.
 */

export interface TransferNotificationProps {
  staffName: string;
  facilityName: string;
  summary: CallSummary;
  /** "Console call" or the caller's number, e.g. "+1 415 555 0100". */
  sourceLabel: string;
  /** Transfer moment already formatted in facility time, e.g. "2:41 PM CDT". */
  transferredAtLabel: string;
  /** Dashboard deep link to the full call record, if the origin is known. */
  callUrl?: string;
}

const palette = {
  pine: "#2f5d50",
  ink: "#211c18",
  muted: "#6d6459",
  faint: "#8a8177",
  cream: "#f6f2ec",
  card: "#ffffff",
  line: "#e7e0d6",
  soft: "#eef3f1",
};

const label: CSSProperties = {
  margin: "0 0 4px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: palette.pine,
};

const value: CSSProperties = {
  margin: "0 0 18px",
  fontSize: "15px",
  lineHeight: "22px",
  color: palette.ink,
};

export function TransferNotification({
  staffName,
  facilityName,
  summary,
  sourceLabel,
  transferredAtLabel,
  callUrl,
}: TransferNotificationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{summary.headline}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: palette.cream,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "32px 16px" }}>
          <Section
            style={{
              backgroundColor: palette.pine,
              borderRadius: "14px 14px 0 0",
              padding: "20px 28px",
            }}
          >
            <Text
              style={{
                margin: 0,
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                color: "#cfe0da",
              }}
            >
              {facilityName}
            </Text>
            <Heading
              as="h1"
              style={{ margin: "6px 0 0", fontSize: "21px", lineHeight: "27px", color: "#ffffff" }}
            >
              A caller is being transferred to you
            </Heading>
          </Section>

          <Section
            style={{
              backgroundColor: palette.card,
              border: `1px solid ${palette.line}`,
              borderTop: "none",
              borderRadius: "0 0 14px 14px",
              padding: "26px 28px",
            }}
          >
            <Text style={{ ...value, marginBottom: "20px" }}>
              Hi {staffName}, Sarah just redirected a live call to you. Here is what was said before
              the handoff.
            </Text>

            <Section
              style={{
                backgroundColor: palette.soft,
                borderRadius: "10px",
                padding: "14px 18px",
                marginBottom: "22px",
              }}
            >
              <Text
                style={{
                  margin: 0,
                  fontSize: "16px",
                  lineHeight: "23px",
                  fontWeight: 600,
                  color: palette.ink,
                }}
              >
                {summary.headline}
              </Text>
            </Section>

            <Text style={label}>Caller</Text>
            <Text style={value}>{summary.caller}</Text>

            <Text style={label}>Why you</Text>
            <Text style={value}>{summary.outcome}</Text>

            <Text style={label}>Key points</Text>
            {summary.keyPoints.map((point) => (
              <Text
                key={point}
                style={{
                  margin: "0 0 6px",
                  fontSize: "15px",
                  lineHeight: "22px",
                  color: palette.ink,
                }}
              >
                &bull;&nbsp; {point}
              </Text>
            ))}

            <Text style={{ ...label, marginTop: "18px" }}>First step</Text>
            <Text style={{ ...value, marginBottom: callUrl ? "24px" : "6px" }}>
              {summary.followUp}
            </Text>

            {callUrl && (
              <Section style={{ textAlign: "center" as const, margin: "4px 0 8px" }}>
                <Link
                  href={callUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: palette.pine,
                    borderRadius: "10px",
                    padding: "11px 22px",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#ffffff",
                    textDecoration: "none",
                  }}
                >
                  View the full call
                </Link>
              </Section>
            )}

            <Hr style={{ borderColor: palette.line, margin: "22px 0 14px" }} />
            <Text
              style={{ margin: 0, fontSize: "12.5px", lineHeight: "19px", color: palette.muted }}
            >
              Transferred at {transferredAtLabel} &middot; {sourceLabel}
            </Text>
            <Text style={{ margin: "4px 0 0", fontSize: "12px", color: palette.faint }}>
              Sent automatically by the {facilityName} reception assistant.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Render the brief to the multipart bodies the SMTP send needs. */
export async function renderTransferEmail(
  props: TransferNotificationProps,
): Promise<{ html: string; text: string }> {
  const html = await render(<TransferNotification {...props} />);
  return { html, text: toPlainText(html) };
}

/** Sample data for the react-email preview server. */
TransferNotification.PreviewProps = {
  staffName: "Mira",
  facilityName: "Pine Lodge Assisted Living",
  summary: {
    headline: "Daughter of a resident calling about a double charge on the March invoice.",
    caller: "Janet Holmes, daughter of resident Arthur Holmes in room 214.",
    keyPoints: [
      "March invoice shows two charges of $2,150 instead of one.",
      "Payment was made by autopay from her checking account.",
      "She has already spoken to the bank; they directed her back to the facility.",
    ],
    outcome: "Billing questions are yours, so Sarah told her you would take the call.",
    followUp: "Pull up the Holmes account before greeting her; she has the invoice in hand.",
  },
  sourceLabel: "Console call",
  transferredAtLabel: "2:41 PM CDT",
  callUrl: "http://localhost:3000/calls/00000000-0000-0000-0000-000000000000",
} satisfies TransferNotificationProps;

export default TransferNotification;
