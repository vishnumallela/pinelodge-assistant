import type { RouteDestination } from "./routing";

/**
 * Transfer execution lives behind this interface so the proof-of-concept
 * simulation can be swapped for a real SIP/telephony provider without touching
 * the routing engine or the call lifecycle. Implement TransferProvider,
 * change the export at the bottom, done.
 */

export interface TransferRequest {
  callId: string;
  destination: RouteDestination;
}

export interface TransferResult {
  outcome: "transferred" | "failed";
  detail: string;
}

export interface TransferProvider {
  readonly kind: string;
  transfer(req: TransferRequest): Promise<TransferResult>;
}

export const simulatedTransferProvider: TransferProvider = {
  kind: "simulated",
  transfer({ destination }) {
    return Promise.resolve({
      outcome: "transferred",
      detail: `Simulated transfer to ${destination.name}, ext. ${destination.extension}.`,
    });
  },
};

/** The provider in effect. Replace with a SIP implementation to go live. */
export const transferProvider: TransferProvider = simulatedTransferProvider;
