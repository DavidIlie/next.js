// Shared printer for test failure reports. Renders the markdown used by both
// the PR test report comment (`scripts/pr-ci-comment.mjs`) and the GitHub job
// summary (`run-tests.js`), so both read the same way. Size limits are the
// caller's responsibility: GitHub comments and job summaries have different
// maximum sizes.

const CONTRIBUTING_URL =
  'https://github.com/vercel/next.js/blob/canary/contributing.md'

function getJobMarker(jobName) {
  const safeName = jobName.replaceAll('-->', '')
  return {
    start: `<!-- J"${safeName}" -->`,
    end: `<!-- /J"${safeName}" -->`,
  }
}

/**
 * @param {object} options
 * @param {string} [options.marker] Leading HTML comment marker identifying the
 *   report, e.g. for finding an existing PR comment. Omitted from job summaries.
 * @param {string} [options.sha] Commit the report is about. The commit line
 *   is skipped when absent.
 * @param {Array<{
 *   jobName?: string,
 *   title: string,
 *   failureLines: string[],
 *   resultMessage?: string,
 * }>} options.suites One entry per failing test suite. `jobName` wraps the
 *   suite in HTML comment markers so tooling can locate per-job sections.
 *   `title` is the fully rendered first line (test command, tags, links).
 *   `failureLines` are rendered as a bullet list. `resultMessage` is rendered
 *   in a collapsed "Expand output" section.
 * @param {Array<{ name: string, url: string, reason?: string }>} [options.otherFailures]
 *   Failing CI jobs without parseable test results.
 * @returns {string} The rendered markdown report.
 */
function buildTestReport({ marker, sha, suites, otherFailures = [] }) {
  const heading =
    suites.length > 0 ? '## Failing test suites' : '## Failing CI jobs'
  const lines = []
  if (marker) {
    lines.push(marker)
  }
  lines.push(heading, '')
  if (sha) {
    lines.push(
      `Commit: ${sha} | [About building and testing Next.js](${CONTRIBUTING_URL})`,
      ''
    )
  }

  for (const suite of suites) {
    const jobMarker = suite.jobName ? getJobMarker(suite.jobName) : null
    if (jobMarker) {
      lines.push(jobMarker.start)
    }
    lines.push(suite.title)

    for (const failureLine of suite.failureLines) {
      lines.push(`- ${failureLine}`)
    }

    if (suite.resultMessage) {
      lines.push('')
      lines.push('<details>')
      lines.push('<summary>Expand output</summary>')
      lines.push('')
      lines.push(suite.resultMessage)
      lines.push('</details>')
    }

    if (jobMarker) {
      lines.push(jobMarker.end)
    }
    lines.push('')
  }

  if (otherFailures.length > 0) {
    if (suites.length > 0) {
      lines.push('### Other failing CI jobs')
      lines.push('')
    }

    for (const { name, url, reason } of otherFailures) {
      lines.push(`- [${name}](${url})${reason ? `: ${reason}` : ''}`)
    }
  }

  return lines.join('\n')
}

/**
 * Link to the Datadog CI test runs of a failed test case, matching how
 * `datadog-ci junit upload` tags the runs in CI.
 *
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.sha The head commit of the run (for pull requests,
 *   the PR head, not the merge commit).
 * @param {string} options.testName Test case name with ancestor titles joined
 *   by spaces.
 * @param {'nextjs' | 'turbopack'} options.testType
 * @returns {string}
 */
function datadogTestRunUrl({ owner, repo, sha, testName, testType }) {
  const query = Object.entries({
    '@git.repository.id': `github.com/${owner}/${repo}`,
    '@git.commit.head_sha': sha,
    '@test.name': testName,
    '@test.type': testType,
    '@test.status': 'fail',
  })
    .map(([key, value]) => `${key}:"${value.replace(/"/g, '\\"')}"`)
    .join(' ')

  const url = new URL('https://app.datadoghq.com/ci/test/runs')
  url.searchParams.set('query', query)
  return url.href
}

module.exports = { buildTestReport, datadogTestRunUrl }
