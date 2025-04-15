import nodemailer from "nodemailer";
import crypto from "crypto";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  // Only attempt email auth if credentials are present
  auth: process.env.EMAIL_USER && process.env.EMAIL_PASSWORD ? {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  } : undefined,
});

export async function sendVerificationEmail(email: string, token: string) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.log('Email credentials not configured, skipping email send');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "RateMyOfficial Registration Request",
      html: `Thank you for your request to join RateMyOfficial! Your account is currently pending approval!`,
    });
  } catch (error) {
    console.error('Failed to send email:', error);
    // Don't throw error to prevent registration process from failing
  }
}

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.log('Email credentials not configured, skipping email send');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error('Failed to send email:', error);
    // Don't throw error to prevent processes from failing
  }
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}