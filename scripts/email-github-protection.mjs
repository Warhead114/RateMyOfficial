// A reviewed code change is required for activation; no environment-variable bypass.
export const PUBLIC_RUNNER_POLICY = Object.freeze({
  enabled: false,
  repository: "Warhead114/RateMyOfficial",
  repositoryId: "947276986",
  ownerId: "133118238",
});
export const validationEnvironment = "production-email-validation";
const refuse = () => { throw new Error("GitHub protection refused"); };

export function validateGitHubContext(env, policy = PUBLIC_RUNNER_POLICY) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_SERVER_URL !== "https://github.com" || env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_RUN_ATTEMPT !== "1" || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || "") ||
    !/^[1-9]\d*$/.test(env.GITHUB_ACTOR_ID || "") || !env.GITHUB_TRIGGERING_ACTOR ||
    env.GITHUB_REPOSITORY !== policy.repository || env.GITHUB_REPOSITORY_ID !== policy.repositoryId ||
    env.GITHUB_REPOSITORY_OWNER_ID !== policy.ownerId ||
    env.GITHUB_REF !== "refs/heads/main" || env.EMAIL_VALIDATION_ALLOWED_REF !== env.GITHUB_REF ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ||
    env.GITHUB_SHA !== env.EMAIL_RUNNER_APPROVED_REVISION ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.EMAIL_VALIDATION_ENVIRONMENT_READY !== "reviewers-required" ||
    !["true", "false"].includes(env.EMAIL_GITHUB_PRIVATE_REPOSITORY) ||
    (env.EMAIL_GITHUB_PRIVATE_REPOSITORY !== "true" && policy.enabled !== true) ||
    env.RUNNER_DEBUG === "1" || env.ACTIONS_STEP_DEBUG === "true" ||
    env.ACTIONS_RUNNER_DEBUG === "true" || env.NODE_OPTIONS || env.NODE_V8_COVERAGE) refuse();
}

// No response bodies, tokens, identities, endpoints or errors are logged.
// The default Actions token needs only contents:read + actions:read.
export async function verifyGitHubProtection(env, fetchImpl = fetch) {
  try {
    if (!env.GITHUB_TOKEN || env.GITHUB_API_URL !== "https://api.github.com") refuse();
    const get = async path => {
      const response = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path ? "/" + path : ""}`, {
        redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (!response.ok) refuse();
      const text = await response.text();
      if (Buffer.byteLength(text) > 1024 * 1024) refuse();
      return JSON.parse(text);
    };
    const repository = await get("");
    if (String(repository.id) !== env.GITHUB_REPOSITORY_ID ||
      String(repository.owner?.id) !== env.GITHUB_REPOSITORY_OWNER_ID ||
      repository.full_name !== env.GITHUB_REPOSITORY ||
      String(repository.private) !== env.EMAIL_GITHUB_PRIVATE_REPOSITORY ||
      repository.default_branch !== "main") refuse();
    const run = await get(`actions/runs/${env.GITHUB_RUN_ID}`);
    if (String(run.id) !== env.GITHUB_RUN_ID || run.status !== "in_progress" ||
      run.head_sha !== env.GITHUB_SHA || run.head_branch !== "main" ||
      run.event !== "workflow_dispatch" || run.run_attempt !== 1 ||
      String(run.repository?.id) !== env.GITHUB_REPOSITORY_ID ||
      run.path?.split("@")[0] !== ".github/workflows/production-email-validation.yml" ||
      !Number.isSafeInteger(run.actor?.id) || run.actor.id <= 0 ||
      String(run.actor.id) !== env.GITHUB_ACTOR_ID ||
      !Number.isSafeInteger(run.triggering_actor?.id) || run.triggering_actor.id <= 0 ||
      run.triggering_actor.login !== env.GITHUB_TRIGGERING_ACTOR) refuse();
    const environment = await get(`environments/${validationEnvironment}`);
    const reviewerRule = environment.protection_rules?.find(r => r.type === "required_reviewers");
    if (environment.name !== validationEnvironment || environment.can_admins_bypass !== false ||
      reviewerRule?.prevent_self_review !== true || !reviewerRule.reviewers?.length ||
      environment.deployment_branch_policy?.custom_branch_policies !== true ||
      environment.deployment_branch_policy?.protected_branches !== false) refuse();
    const branches = await get(`environments/${validationEnvironment}/deployment-branch-policies`);
    if (branches.total_count !== 1 || branches.branch_policies?.length !== 1 ||
      branches.branch_policies[0].name !== "main" || branches.branch_policies[0].type !== "branch") refuse();
    const history = await get(`actions/runs/${env.GITHUB_RUN_ID}/approvals`);
    if (!Array.isArray(history) || !Number.isSafeInteger(environment.id)) refuse();
    const relevant = history.filter(h => h.environments?.some(e => e.id === environment.id));
    const reviewers = reviewerRule.reviewers.filter(r => r.type === "User" &&
      Number.isSafeInteger(r.reviewer?.id) && r.reviewer.id > 0).map(r => r.reviewer.id);
    if (relevant.some(h => h.state === "rejected") || !relevant.some(h =>
      h.state === "approved" && Number.isSafeInteger(h.user?.id) && reviewers.includes(h.user.id) &&
      h.user.id !== run.actor.id && h.user.id !== run.triggering_actor.id)) refuse();
    return true;
  } catch { refuse(); }
}
