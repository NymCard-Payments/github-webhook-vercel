import fetch from 'node-fetch';

// Webhook handler
export default async function handler(req, res) {
  if (req.method === 'POST') {
    const commitData = req.body;

    // Validate if this is a push event, if not, exitt
    if (!commitData.ref || !commitData.commits) {
      return res.status(400).json({ error: 'Not a valid push event' });
    }

    const commits = await Promise.all(
      commitData.commits
        .filter(commit => commit.author.username !== 'Devtools')
        .map(async commit => {
          // Calculate lines of code (LOC) for each commit using the GitHub API
          const loc = await calculateLOC(commit.id, commitData.repository.owner.name, commitData.repository.name);

          return {
            message: commit.message,
            username: commit.author.username || commit.author.name,
            author: commit.author.name,
            url: commit.url,
            timestamp: commit.timestamp,
            repository: commitData.repository.name,
            loc: loc,
          };
        })
    );

    // If no commits remain after filtering, skip sending to Monday.com
    if (commits.length === 0) {
      return res.status(200).json({ message: 'No valid commits to process' });
    }

    // Send the commits to Monday.com
    try {
      const mondayResult = await sendCommitsToMonday(commits);
      res.status(200).json({ success: true, data: mondayResult });
    } catch (error) {
      console.error('Error sending data to Monday.com:', error);
      res.status(500).json({ error: 'Failed to send data to Monday.com' });
    }
  } else {
    res.status(405).json({ message: 'Only POST requests are accepted' });
  }
}

// Function to calculate LOC for a given commit hash using GitHub API
async function calculateLOC(commitHash, repoOwner, repoName) {
  const githubToken = process.env.GITHUB_TOKEN; // Create a GitHub token and set it in your environment variables

  // Construct the API URL
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${commitHash}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'User-Agent': 'Vercel-Webhook',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Parse the diff data
    let additions = 0;
    let deletions = 0;

    data.files.forEach(file => {
      additions += file.additions;
      deletions += file.deletions;
    });

    return additions - deletions;
  } catch (error) {
    console.error('Error calculating LOC from GitHub API:', error);
    return 0; // Default LOC if an error occurs
  }
}

// Function to send commits data to Monday.com
async function sendCommitsToMonday(commits) {
  const mondayApiUrl = 'https://api.monday.com/v2';
  const mondayApiKey = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;

  const results = [];

  // Loop through each commit and send it as an item to the Monday.com board
  for (const commit of commits) {
    // Format timestamp to only include date (e.g., 2023-10-03)
    const formattedTimestamp = commit.timestamp.split('T')[0];

    // GraphQL mutation query to create an item on the Monday.com board
    const query = `
      mutation {
        create_item (
          board_id: ${boardId},
          item_name: "${commit.message}",
          column_values: "{\\"text4__1\\": \\"${commit.author}\\", \\"text6__1\\": \\"${commit.username}\\", \\"text__1\\": \\"${commit.url}\\", \\"date__1\\": \\"${formattedTimestamp}\\", \\"text8__1\\": \\"${commit.repository}\\", \\"numbers__1\\": \\"${commit.loc}\\"}"
        ) {
          id
        }
      }
    `;

    // Send the request to the Monday.com API
    const response = await fetch(mondayApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mondayApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    // Handle the API response and store the result
    const result = await response.json();
    results.push(result);
  }

  return results;
}
