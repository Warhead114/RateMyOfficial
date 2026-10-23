export async function sendEmail(_to: string, _subject: string, _html: string) {
  return {
    success: false,
    error: "Legacy direct email delivery is disabled; use the email outbox",
  };
}