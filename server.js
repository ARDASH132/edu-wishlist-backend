import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: "No token provided",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.userId = decoded.userId;

    next();
  } catch {
    return res.status(401).json({
      error: "Invalid token",
    });
  }
}

app.get("/", (req, res) => {
  res.json({
    message: "Edu Wishlist API is running",
  });
});

app.get("/api/goals", authMiddleware, async (req, res) => {
  try {
    const goals = await prisma.goal.findMany({
      where: {
        userId: req.userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(goals);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch goals",
    });
  }
});

app.post("/api/goals/generate-plan", authMiddleware, async (req, res) => {
  try {
    const { goal } = req.body || {};

    if (!goal) {
      return res.status(400).json({
        error: "Goal is required",
      });
    }

    const response = await client.chat.completions.create({
      model: "deepseek/deepseek-chat",

      response_format: {
        type: "json_object",
      },

      extra_headers: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Edu Wishlist MVP",
      },

      messages: [
        {
          role: "system",

          content: `
Ты — AI-помощник образовательного вишлиста.

Пользователь пишет учебную цель или желание.
Твоя задача — превратить её в понятный пошаговый учебный план.

ОЧЕНЬ ВАЖНО:
- Отвечай только валидным JSON.
- Не пиши текст до JSON или после JSON.
- Не используй markdown.
- Не используй \`\`\`json.
- Все строки должны быть на русском языке.

Верни JSON строго в таком формате:

{
  "wish_title": "Краткое красивое название цели",
  "category": "Короткая категория",
  "cover_icon": "🔥",
  "steps": [
    {
      "title": "Короткое конкретное действие",
      "details": "Подробное объяснение, что именно нужно изучить или сделать"
    }
  ]
}

Правила:
- steps: от 3 до 7 шагов.
- Каждый steps.title должен быть коротким, конкретным и подходить для чекбокса.
- Каждый steps.details должен объяснять этот шаг простыми словами.
- Не указывай длительность в title.
- В details можно дать примеры, что именно изучить.
- Не используй слишком общие шаги вроде "Практиковаться больше".
- category должна быть короткой.
- cover_icon должен быть одним эмодзи.
- wish_title должен быть понятным и привлекательным.
          `,
        },

        {
          role: "user",
          content: `Моя учебная цель: ${goal}`,
        },
      ],
    });

    const aiContent =
      response.choices[0].message.content;

    const savedGoal = await prisma.goal.create({
      data: {
        title: goal,
        plan: aiContent,
        userId: req.userId,
      },
    });

    res.json(savedGoal);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "AI generation failed",
    });
  }
});

app.get("/api/goals/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findUnique({
      where: { id },
    });

    if (!goal) {
      return res.status(404).json({
        error: "Goal not found",
      });
    }

    if (goal.userId !== req.userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    res.json(goal);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch goal",
    });
  }
});

app.delete("/api/goals/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findUnique({
      where: { id },
    });

    if (!goal || goal.userId !== req.userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    await prisma.goal.delete({
      where: { id },
    });

    res.json({
      message: "Goal deleted successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to delete goal",
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser =
      await prisma.user.findUnique({
        where: {
          email,
        },
      });

    if (existingUser) {
      return res.status(400).json({
        error: "User already exists",
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
      },

      process.env.JWT_SECRET,

      {
        expiresIn: "7d",
      }
    );

    res.json({
      token,

      user: {
        id: user.id,
        email: user.email,
      },
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Registration failed",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      return res.status(400).json({
        error: "Invalid credentials",
      });
    }

    const isPasswordCorrect =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!isPasswordCorrect) {
      return res.status(400).json({
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
      },

      process.env.JWT_SECRET,

      {
        expiresIn: "7d",
      }
    );

    res.json({
      token,

      user: {
        id: user.id,
        email: user.email,
      },
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Login failed",
    });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    });

    res.json(users);

  } catch {
    res.status(500).json({
      error: "Failed to fetch users",
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log(
    `Server running on http://localhost:${process.env.PORT}`
  );
});