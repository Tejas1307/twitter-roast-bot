const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Gemini
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genai.getGenerativeModel({ model: "gemini-1.5-pro" });

// Initialize Twitter client for bot operations
const botClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Initialize Twitter OAuth client separately
const authClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

// Generate auth link
app.get('/auth', async (req, res) => {
  const { url, codeVerifier, state } = authClient.generateOAuth2AuthLink(
    'https://your-app-name.onrender.com/callback',
    { scope: ['tweet.read', 'tweet.write', 'users.read'] }
  );
  
  // Store codeVerifier somewhere secure (like a session)
  process.env.CODE_VERIFIER = codeVerifier;
  
  res.redirect(url);
});

const roastTemplate = `
You are a witty roast bot. Create a funny and clever roast for the following tweet.
Keep it playful and avoid being mean-spirited or offensive.

Tweet: {tweet_text}

Generate a roast response in under 280 characters:
`;

class RoastBot {
  constructor() {
    this.lastMentionId = null;
  }

  async generateRoast(tweetText) {
    const prompt = roastTemplate.replace('{tweet_text}', tweetText);
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  }

  async handleMentions(client) {
    try {
      const me = await client.v2.me();
      const mentions = await client.v2.userMentionTimeline(me.data.id, {
        since_id: this.lastMentionId,
      });

      if (!mentions.data) return;

      for (const mention of mentions.data) {
        // Update last mention ID
        if (!this.lastMentionId || mention.id > this.lastMentionId) {
          this.lastMentionId = mention.id;
        }

        // Get original tweet
        if (mention.referenced_tweets) {
          const originalTweet = await client.v2.tweet(mention.referenced_tweets[0].id);
          if (originalTweet.data) {
            // Generate roast
            const roast = await this.generateRoast(originalTweet.data.text);

            // Reply with roast
            await client.v2.tweet(roast, {
              reply: { in_reply_to_tweet_id: mention.id },
            });
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

// Create bot instance
const bot = new RoastBot();

// Set up periodic check for mentions
setInterval(async () => {
  await bot.handleMentions(botClient);
}, 60000);

// Basic endpoint to keep the repl alive
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Add callback endpoint for Twitter OAuth
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { accessToken, refreshToken } = await authClient.loginWithOAuth2({
      code,
      redirectUri: 'https://your-app-name.onrender.com/callback',
      codeVerifier: process.env.CODE_VERIFIER,
    });
    
    // Store these tokens securely
    console.log('Access Token:', accessToken);
    console.log('Refresh Token:', refreshToken);
    
    res.send('Authentication successful!');
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.listen(port, () => {
  console.log(`Bot server running on port ${port}`);
});