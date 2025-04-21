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

export class MyMCP extends McpAgent<Env> {
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
            {
                filename: z.string().optional().default("CCPH_subject.json"), // 默认读取 CCPH_subject.json 文件
                count: z.number().optional().default(30),
            },
            async ({ filename, count }) => {
                try {
                    // 确保 env 存在，并且 env 中包含你的存储桶 DATASET
                    if (!this.env || !this.env.DATASET) {
                        return {
                            content: [{
                                type: "text",
                                text: "存储桶未配置。",
                            }],
                        };
                    }

                    const bucket = this.env.DATASET;
                    const object = await bucket.get(filename);

                    if (!object) {
                        return {
                            content: [{
                                type: "text",
                                text: `文件 "${filename}" 在存储桶中未找到。`,
                            }],
                        };
                    }

                    const fileContent = await object.text();
                    let questionsData: Question[];
                    try {
                        questionsData = JSON.parse(fileContent) as Question[];
                        if (!Array.isArray(questionsData)) {
                            return {
                                content: [{
                                    type: "text",
                                    text: `文件 "${filename}" 未包含题目 JSON 数组。`,
                                }],
                            };
                        }
                    } catch (error) {
                        return {
                            content: [{
                                type: "text",
                                text: `解析文件 "${filename}" 中的 JSON 失败: ${error.message}`,
                            }],
                        };
                    }

                    const numQuestionsToGenerate = Math.min(count, questionsData.length); // 确保不会抽取超过总数的题目

                    // 创建一个副本，进行洗牌，然后取出前 numQuestionsToGenerate 个元素
                    const shuffledQuestions = [...questionsData]; // 创建数组副本

                    // 实现 Fisher-Yates (Knuth) 洗牌算法
                    for (let i = shuffledQuestions.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffledQuestions[i], shuffledQuestions[j]] = [shuffledQuestions[j], shuffledQuestions[i]]; // 交换元素
                    }

                    const selectedQuestions = shuffledQuestions.slice(0, numQuestionsToGenerate);

                    const formattedContent = selectedQuestions.map(item => {
                        try {
                            // 将每个对象转换为 JSON 字符串
                            return {
                                type: "text",
                                text: JSON.stringify(item, null, 2), // 使用 JSON.stringify 并格式化输出
                            };
                        } catch (stringifyError) {
                            // 如果对象无法被 JSON.stringify 转换
                            console.error("将对象转换为 JSON 字符串失败:", stringifyError, item);
                            return {
                                type: "error",
                                error: `无法处理题目对象: ${stringifyError.message}`,
                            };
                        }
                    });

                    // const firstFewQuestions = questionsData.slice(0, 5)

                    return { content: formattedContent };

                } catch (error) {
                    console.error("生成题目时发生错误:", error);
                    return {
                        content: [{
                            type: "text",
                            text: `生成题目失败: ${error.message}`,
                        }],
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
