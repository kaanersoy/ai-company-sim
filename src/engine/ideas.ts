/** Product-domain inspirations: one is picked per world (by its seed) so every Reset starts from a different idea. */
export interface Idea { pitch: string; product: string; team: { role: string; salary: number; personality: string }[] }

export const IDEAS: Idea[] = [
  { pitch: "stock and ordering for small cafes", product: "A stock-tracking tool for a small cafe chain.",
    team: [{ role: "engineer", salary: 40, personality: "pragmatic" }, { role: "engineer", salary: 40, personality: "curious" }, { role: "marketing", salary: 35, personality: "talkative" }] },
  { pitch: "online booking and reminders for small clinics", product: "A booking and reminder app for small clinics.",
    team: [{ role: "engineer", salary: 45, personality: "careful" }, { role: "marketing", salary: 35, personality: "friendly" }] },
  { pitch: "class schedules and memberships for gyms", product: "A class scheduling and membership tool for gyms.",
    team: [{ role: "engineer", salary: 40, personality: "fast" }] },
  { pitch: "invoicing and expense tracking for freelancers", product: "A simple invoicing and expense tracker for freelancers.",
    team: [{ role: "engineer", salary: 40, personality: "pragmatic" }, { role: "finance", salary: 40, personality: "thrifty" }] },
  { pitch: "daily order and pickup planning for bakeries", product: "An order and pickup planner for small bakeries.",
    team: [{ role: "engineer", salary: 40, personality: "curious" }, { role: "engineer", salary: 35, personality: "calm" }, { role: "finance", salary: 40, personality: "thrifty" }] },
];

export const pickIdea = (seed: number): Idea => IDEAS[Math.abs(Math.floor(seed)) % IDEAS.length];
export const ideaByPitch = (text: string): Idea | undefined => IDEAS.find((i) => text.includes(i.pitch));
