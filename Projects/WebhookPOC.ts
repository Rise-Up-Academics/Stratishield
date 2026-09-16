import express from "express";
import { Queue, Worker } from "bullmq";
import { readFile } from "fs/promises";

// Create the web application
const app = express();
app.use(express.json());

// Connection to Redis
const connection =
{
    host: "localhost",
    port: 6379
};

// Creates a Bull Queue
const fileQueue = new Queue(
    "fileQueue",
    { connection: connection }
);

// Creates the background worker
const worker = new Worker(
    "fileQueue",

    async function (job)
    {
        console.log("Background job started...");

        const file = await readFile(
            job.data.fileName,
            "utf8"
        );

        console.log("File contents:");
        console.log(file);

        console.log(
            "Background task completed!"
        );
    },

    { connection: connection }
);

// Create the webhook endpoint
app.post(
    "/webhook",

    async function (req, res)
    {
        const fileName =
            req.body.fileName || "sample-email.txt";

        await fileQueue.add(
            "processFile",
            {
                fileName: fileName
            }
        );

        res.send(
            "Webhook received and job added to queue!"
        );
    }
);

// Start the web server
app.listen(
    3000,

    function ()
    {
        console.log(
            "Webhook POC running on port 3000"
        );
    }
);