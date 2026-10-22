import type {
  EmailMessage,
  EmailProvider,
  EmailProviderResult,
} from "./provider";

export type FakeEmailOutcome =
  | "success"
  | "transient_failure"
  | "permanent_failure"
  | "timeout"
  | "rate_limited";

export class FakeEmailProvider implements EmailProvider {
  readonly sentMessages: EmailMessage[] = [];
  private readonly outcomes: FakeEmailOutcome[] = [];
  private messageSequence = 0;

  queueOutcome(outcome: FakeEmailOutcome): void {
    this.outcomes.push(outcome);
  }

  queueOutcomes(...outcomes: FakeEmailOutcome[]): void {
    this.outcomes.push(...outcomes);
  }

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    const outcome = this.outcomes.shift() ?? "success";

    if (outcome === "success") {
      this.sentMessages.push(message);
      this.messageSequence += 1;
      return {
        outcome: "success",
        providerMessageId: `fake-message-${this.messageSequence}`,
      };
    }

    if (outcome === "rate_limited") {
      return {
        outcome: "transient_failure",
        errorCode: "RATE_LIMITED",
        diagnostic: "Fake provider rate limit",
      };
    }

    if (outcome === "timeout") {
      return {
        outcome: "transient_failure",
        errorCode: "TIMEOUT",
        diagnostic: "Fake provider timeout",
      };
    }

    return {
      outcome,
      errorCode: outcome === "transient_failure" ? "TEMPORARY_FAILURE" : "PERMANENT_FAILURE",
      diagnostic: `Fake provider ${outcome}`,
    };
  }
}
