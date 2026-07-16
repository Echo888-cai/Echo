import { and, eq } from "drizzle-orm";
import { teams, teamMemberships } from "../schema/team.js";
import { users } from "../schema/auth.js";
import { database } from "./context.js";

export async function createTeam(ownerId: string, name: string, slug: string) {
  const id = crypto.randomUUID();
  const [row] = await database().insert(teams).values({ id, name, slug, ownerId }).returning();
  await database().insert(teamMemberships).values({ teamId: id, userId: ownerId, role: "owner" });
  return row;
}

export async function getTeam(teamId: string) {
  const [row] = await database().select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return row ?? null;
}

export async function listTeamsForUser(userId: string) {
  return database()
    .select({ id: teams.id, name: teams.name, slug: teams.slug, role: teamMemberships.role })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId));
}

export async function addMember(teamId: string, userId: string, role = "viewer") {
  const [row] = await database()
    .insert(teamMemberships)
    .values({ teamId, userId, role })
    .onConflictDoUpdate({ target: [teamMemberships.teamId, teamMemberships.userId], set: { role } })
    .returning();
  return row;
}

export async function removeMember(teamId: string, userId: string) {
  await database()
    .delete(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)));
}

export async function listMembers(teamId: string) {
  return database()
    .select({
      userId: teamMemberships.userId,
      role: teamMemberships.role,
      username: users.username,
      displayName: users.displayName,
      createdAt: teamMemberships.createdAt
    })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(eq(teamMemberships.teamId, teamId));
}
