import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// 定义题目对象的类型，假设每个题目至少有一个 'question' 字段
interface Question {
    question?: string;
    [key: string]: any; // 允许其他任意属性
}

// 需要在 MyMCP 类中访问 Worker 的环境 (env)
interface Env {
    DATASET: R2Bucket; // 假设你的存储桶绑定名为 DATASET，类型为 R2Bucket
    // 其他环境变量可以添加到这里
}

export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "Demo",
        version: "1.0.0",
    });

    async init() {
        this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
            content: [{ type: "text", text: String(a + b) }],
        }));

        // 添加名为 generate 的函数，从 JSON 文件随机抽取题目
        this.server.tool(
            "generate",
            z.object({
                filename: z.string().optional().default("CCPH_subject.json"), // 默认读取 CCPH_subject.json 文件
                count: z.number().optional().default(30), // 默认抽取 30 道题目
            }),
            async ({ filename, count }) => {
                try {
                    // 确保 env 存在，并且 env 中包含你的存储桶 DATASET
                    if (!this.env || !this.env.DATASET) {
                        return {
                            content: [{
                                type: "error",
                                error: "存储桶未配置。",
                            },],
                        };
                    }

                    const bucket = this.env.DATASET;
                    const object = await bucket.get(filename);

                    if (!object) {
                        return {
                            content: [{
                                type: "error",
                                error: `文件 "${filename}" 在存储桶中未找到。`,
                            },],
                        };
                    }

                    const fileContent = await object.text();
                    let questionsData: { question?: string;[key: string]: any }[];
                    try {
                        questionsData = JSON.parse(fileContent) as { question?: string;[key: string]: any }[];
                        if (!Array.isArray(questionsData)) {
                            return {
                                content: [{
                                    type: "error",
                                    error: `文件 "${filename}" 未包含题目 JSON 数组。`,
                                },],
                            };
                        }
                    } catch (error) {
                        return {
                            content: [{
                                type: "error",
                                error: `解析文件 "${filename}" 中的 JSON 失败: ${error.message}`,
                            },],
                        };
                    }

                    const allQuestions = questionsData;
                    const numQuestionsToGenerate = Math.min(count, allQuestions.length); // 确保不会抽取超过总数的题目
                    const selectedQuestions: { question?: string;[key: string]: any }[] = [];
                    const availableIndices = [...Array(allQuestions.length).keys()]; // 创建一个包含所有索引的数组

                    // 随机选择不重复的索引
                    for (let i = 0; i < numQuestionsToGenerate; i++) {
                        const randomIndex = Math.floor(Math.random() * availableIndices.length);
                        const originalIndex = availableIndices.splice(randomIndex, 1)[0]; // 移除已选择的索引
                        selectedQuestions.push(allQuestions[originalIndex]);
                    }

                    // 假设 JSON 中的每个题目对象都有一个 'question' 字段
                    const formattedQuestions = selectedQuestions.map((item) => ({
                        type: "text",
                        text: item.question || String(item), // 如果有 'question' 字段则使用，否则尝试直接转换为字符串
                    }));

                    return {
                        content: formattedQuestions,
                    };
                } catch (error) {
                    console.error("生成题目时发生错误:", error);
                    return {
                        content: [{
                            type: "error",
                            error: `生成题目失败: ${error instanceof Error ? error.message : String(error)}`,
                        },],
                    };
                }
            }
        );
    }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
    apiRoute: "/sse",
    // TODO: fix these types
    // @ts-ignore
    apiHandler: MyMCP.mount("/sse"),
    // @ts-ignore
    defaultHandler: app,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
});
