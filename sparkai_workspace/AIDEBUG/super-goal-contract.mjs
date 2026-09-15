const defaultProfileId = "super-goal-specialists";

export function validateSuperGoalProfile(catalog, superGoal, taskIds) {
  const profileId = String(catalog?.superGoalProfile || defaultProfileId);
  const profile = catalog?.profiles?.[profileId];
  if (!profile || !Array.isArray(profile.agents)) {
    throw new Error(`AIDEBUG catalog must define SUPER GOAL profile ${profileId}.`);
  }

  const knownTaskIds = taskIds instanceof Set
    ? taskIds
    : new Set(Object.keys(catalog?.tasks || {}));
  const agents = new Map(profile.agents.map((agent) => [agent.id, agent]));
  const ownerLanes = new Set();
  let verificationTaskCount = 0;

  for (const workstream of superGoal?.workstreams || []) {
    const ownerLane = String(workstream?.ownerLane || "");
    const agent = agents.get(ownerLane);
    if (!agent) {
      throw new Error(`SUPER GOAL profile ${profileId} is missing ownerLane ${ownerLane} for workstream ${workstream.id}.`);
    }
    ownerLanes.add(ownerLane);

    const agentTasks = new Set(agent.tasks || []);
    const missingTasks = [];
    for (const taskId of workstream.verificationTasks || []) {
      if (!knownTaskIds.has(taskId)) {
        throw new Error(`SUPER GOAL workstream ${workstream.id} refers to unknown task ${taskId}.`);
      }
      verificationTaskCount += 1;
      if (!agentTasks.has(taskId)) missingTasks.push(taskId);
    }
    if (missingTasks.length) {
      throw new Error(`SUPER GOAL ownerLane ${ownerLane} does not cover verificationTasks for workstream ${workstream.id}: ${missingTasks.join(", ")}.`);
    }
  }

  return {
    superGoalProfile: profileId,
    ownerLaneCount: ownerLanes.size,
    verificationTaskCount
  };
}
