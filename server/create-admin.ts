import bcrypt from "bcryptjs";
import { pool } from "./db";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@shared/schema";

async function createAdmin() {
  const db = drizzle({ client: pool, schema });
  const hashedPassword = await bcrypt.hash("W@rhead 133!", 10);
  
  const [admin] = await db.insert(schema.users).values({
    email: "warhead133@yahoo.com",
    password: hashedPassword,
    firstName: "Zack",
    lastName: "Warfield",
    role: "Admin",
    userType: "Admin",
    isVerified: true,
    createdAt: new Date()
  }).returning();
  
  console.log("Admin user created:", admin);
  process.exit(0);
}

createAdmin().catch(console.error);
