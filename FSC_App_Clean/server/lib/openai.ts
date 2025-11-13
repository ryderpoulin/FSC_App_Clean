import OpenAI from "openai";

// Using Replit's AI Integrations service for OpenAI
// This uses the blueprint:javascript_openai_ai_integrations integration
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export async function chatWithAssistant(
  tripId: string,
  userMessage: string,
  tripContext: string
): Promise<string> {
  try {
    const systemPrompt = `You are a helpful trip management assistant for Field Studies, a student-led outdoor organization.

Trip Context:
${tripContext}

You can help with:
1. Randomizing rosters (selecting drivers and non-drivers randomly)
2. Adding participants from the waitlist to the roster
3. Providing information about the current trip status

When the user asks you to perform an action:
- Be friendly and confirm what you understand
- Explain what action would be taken
- Note that the actual action will be performed by the system

Keep responses concise and helpful. If asked to do something you can't help with, politely explain your capabilities.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_completion_tokens: 500,
    });

    return response.choices[0]?.message?.content || "I'm sorry, I couldn't process that request.";
  } catch (error) {
    console.error("OpenAI API error:", error);
    throw new Error("Failed to get AI response. Please try again.");
  }
}
