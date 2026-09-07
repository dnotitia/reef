import { json } from "./mock-http.mjs";

export function handleGitHub(req, res, url, state) {
  const path = url.pathname.slice("/github".length);
  if (
    req.method === "POST" &&
    /^\/app\/installations\/[^/]+\/access_tokens$/.test(path)
  ) {
    return json(res, 201, {
      token: "ghs_e2e_installation_token",
      expires_at: "2026-06-15T01:00:00.000Z",
      permissions: { contents: "read", metadata: "read" },
      repository_selection: "selected",
    });
  }
  if (req.method === "POST" && path.endsWith("/graphql")) {
    return json(res, 200, {
      data: {
        repository: {
          defaultBranchRef: {
            target: {
              history: {
                nodes: [],
              },
            },
          },
          pullRequests: {
            nodes: [],
          },
        },
      },
    });
  }
  if (req.method === "GET" && path === "/user/repos") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: '"reef-e2e-repos"',
    });
    res.end(JSON.stringify(state.githubRepos));
    return;
  }
  if (req.method === "GET" && path === "/installation/repositories") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: '"reef-e2e-installation-repos"',
    });
    res.end(
      JSON.stringify({
        total_count: state.githubRepos.length,
        repositories: state.githubRepos,
      }),
    );
    return;
  }
  if (req.method === "GET") {
    return json(res, 200, {
      items: [],
      total_count: 0,
      incomplete_results: false,
    });
  }
  return json(res, 200, {});
}
