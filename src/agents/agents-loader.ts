import { join } from "node:path";
import { parseFrontmatter } from "../parsing";
import {
	type AgentDefinition,
	AgentFrontmatterSchema,
} from "./schemas/agent.schema";

export async function loadAgentDefinition(
	agentsPath: string,
	agentId: string,
): Promise<AgentDefinition> {
	const agentFilePath = join(agentsPath, agentId, "AGENT.md");
	const definitionFile = await Bun.file(agentFilePath).text();

	const { frontmatter, body } = parseFrontmatter(definitionFile);
	const agentFrontmatter = AgentFrontmatterSchema.parse(frontmatter);

	return {
		id: agentId,
		name: agentFrontmatter.name,
		description: agentFrontmatter.description,
		instructions: body,
	};
}
