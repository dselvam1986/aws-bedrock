
import { Request, Response } from 'express';
import fs from "fs";
import { LambdaClient, InvokeCommand, InvocationRequest } from "@aws-sdk/client-lambda";
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import path from 'path';
import { Upload } from '@aws-sdk/lib-storage';
import { BedrockAgentClient, ListAgentsCommand, ListFlowsCommand } from "@aws-sdk/client-bedrock-agent";
import { BedrockAgentRuntimeClient, InvokeFlowCommand, FlowInput, FlowInputContent } from "@aws-sdk/client-bedrock-agent-runtime"

require('dotenv').config();

// Initialize the S3 client
const s3Client = new S3Client({
    region: process.env.REACT_APP_AWS_REGION,
    credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || '',
    }
});
   
// Initialize the Lambda client
const lambdaClient = new LambdaClient({
    region: process.env.REACT_APP_AWS_REGION,
    credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || '',
    },
});

// Initialize the Bedrock client
const bedrockFlowClient = new BedrockAgentRuntimeClient({
  region: process.env.REACT_APP_AWS_REGION, // Ensure you specify your AWS region
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || '',
  },
});

// To get list of flows
const bedrockAgentClient = new BedrockAgentClient({ region: "us-east-1", credentials: {
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || '',
} }); // Change to your AWS region


// flow id
const flowName = "ds-bagenie-test-flow";
const bedrockFlowId = "SWC7KZMB7S";

export const handleFileUpload = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
      res.status(400).send("No file uploaded.");
      return  
  }

  let originalName = req.file.originalname;
  let uploadedFile = [];
  uploadedFile.push(req.file)

  // console.log('file path', req.file.path)

  // upload file to s3
  let fileUrls =  await uploadFilesToS3(uploadedFile);

  // console.log("File url", fileUrls);

  // loop through each file url and send to lambda function 
  let lambdaResponse: Promise<any>[] = []
  
  // then use lambda function to get text and same it back to s3 - get key for the text ref
  let result = await invokeLambdaFunction(fileUrls)
  
  let extractedText = getExtractedTextFromBody(result.body);

  // console.log("extractedText", extractedText);

  // save extracted text to S3
  let extractedTextKey = await uploadTextToS3(extractedText[0], originalName);

  console.log('key of extracted text', extractedTextKey)
  // pass the key and prompt to bedrock. 
  let structuredResult = await invokeBedrockFlow(flowName, extractedTextKey);

  // get structured result from bedrock.
  console.log('result', structuredResult);

  res.status(200).send(`File uploaded successfully`);
};

// Function to upload files to S3
const uploadFilesToS3 = async (files: any, bucketName = process.env.REACT_APP_S3_BUCKET_NAME) => {
  console.log('[UPLOAD_FILES_TO_S3] Starting the file upload process.');
  const uploadedFileUrls = [];

  for (const file of files) {
    console.log(`[UPLOAD_FILES_TO_S3] Preparing to upload file: ${file.originalname}`);

    const fileStream = fs.createReadStream(file.path);
    const timestamp = Date.now();
    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: bucketName,
            Key: `uploads/${timestamp}-${file.originalname}`,
            Body: fileStream,
        },
    })

    
    // const uploadParams = {
    //   Bucket: bucketName,
    //   Key: `uploads/${timestamp}-${file.originalname}`,
    //   Body: fileStream,
    //   ContentType: file.mimetype,
    //   ContentLength: file.size
    // };
 
    try {
        const result = await upload.done();
        console.log(`[UPLOAD_FILES_TO_S3] File upload successfully`);
        // console.log(result);
 
        const fileUrl = `https://${bucketName}.s3.amazonaws.com/uploads/${timestamp}-${file.originalname}`;
        uploadedFileUrls.push(fileUrl);
        console.log(`[UPLOAD_FILES_TO_S3] File URL added: ${fileUrl}`);

    } catch (error) {
        console.error(
            `[UPLOAD_FILES_TO_S3] Error uploading file: ${file.originalname}`
        );
        throw error;
    }
  }
 
  console.log(
    '[UPLOAD_FILES_TO_S3] File upload process completed. Uploaded file URLs:',
    uploadedFileUrls
  );
  return uploadedFileUrls;
};

// Function to invoke a Lambda function
export const invokeLambdaFunction = async (fileUrls: any) => {
    console.log('[INVOKE_LAMBDA_FUNCTION] Starting Lambda invocation.');
    console.log('[INVOKE_LAMBDA_FUNCTION] File URLs to send:', fileUrls);
   
    // @ts-ignore
    const lambdaParams: InvocationRequest = {
      FunctionName: 'ba-genie-dev-testExtractMultipleFiles',
      InvocationType: 'RequestResponse',
      // @ts-ignore
      Payload: JSON.stringify({ fileUrls }),
    };
   // new TextEncoder().encode()
    try {
      const response = await lambdaClient.send(new InvokeCommand(lambdaParams));
      const rawPayload = new TextDecoder('utf-8').decode(response.Payload);
      const jsonResponse = JSON.parse(rawPayload);
   
      // console.log(
      //   '[INVOKE_LAMBDA_FUNCTION] Received response from Lambda function:',
      //   jsonResponse
      // );
   
      if (jsonResponse.statusCode === 200) {
        return jsonResponse;
      } else {
        console.error(
          `[INVOKE_LAMBDA_FUNCTION] Error response from Lambda function: ${jsonResponse.message}`
        );
        throw new Error(jsonResponse.message);
      }
    } catch (error: any) {
      console.error(
        `[INVOKE_LAMBDA_FUNCTION] Error invoking Lambda function: ${error.message}`
      );
      throw error;
    }
};

// Extracts the `extractedText` values from the Lambda response body.
function getExtractedTextFromBody(body:any) {
    // Parse the body if it's a string (e.g., from JSON response)
    const parsedBody = typeof body === "string" ? JSON.parse(body) : body;
  
    // Ensure the structure is correct
    if (!parsedBody || !parsedBody.results || typeof parsedBody.results !== "object") {
      throw new Error("Invalid body format. Results object not found.");
    }
  
    const extractedTexts = [];
  
    // Iterate through the results object
    for (const filePath in parsedBody.results) {
      if (parsedBody.results.hasOwnProperty(filePath)) {
        const result = parsedBody.results[filePath];
  
        // Check if extractedText exists and add it to the array
        if (result && result.extractedText) {
          extractedTexts.push(result.extractedText);
        }
      }
    }
  
    return extractedTexts;  
  }

// Function to upload extracted text to S3
const uploadTextToS3 = async (extractedText: any, fileName: string,  bucketName = process.env.REACT_APP_S3_BUCKET_NAME) => {
  console.log('[UPLOAD_TXT_TO_S3] Starting the txt upload process.');
  let uploadedTextKey;

    const timestamp = Date.now();
    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: bucketName,
            Key: `input/${fileName}-extracted.txt`,
            Body: extractedText,
            ContentType: 'text/plain'
        },
    })
 
    try {
        const result = await upload.done();
        console.log(`[UPLOAD_TXT_TO_S3] TXT upload successfully`);
        // console.log("key should be here", result);
 
        uploadedTextKey = result.Key;

    } catch (error) {
        console.error(
            `[UPLOAD_TXT_TO_S3] Error uploading TXT`
        );
        throw error;
    }
 
  return uploadedTextKey
};

const invokeBedrockFlow = async (flowId: string , inputText: any) => {
  
  try {
    const paramsBreakdown = {
      flowAliasIdentifier:
        process.env.REACT_APP_EPIC_BREAKDOWN_FLOW_ALIAS_IDENTIFIER,
      flowIdentifier: process.env.REACT_APP_EPIC_BREAKDOWN_FLOW_IDENTIFIER,
      inputs: [
        {
          content: { document: inputText },
          nodeName: 'FlowInputNode',
          nodeOutputName: 'document',
        },
      ],
    };

    const commandBreakdown = new InvokeFlowCommand(paramsBreakdown);
    const responseBreakdown = await bedrockFlowClient.send(commandBreakdown);

    let workItemsArray: any[] = [];
    // @ts-ignore
    for await (const chunk of responseBreakdown.responseStream) {
      if (chunk.flowOutputEvent) {
        try {
          // @ts-ignore
          const chunkData = JSON.parse(chunk.flowOutputEvent.content.document);
          if (Array.isArray(chunkData)) {
            workItemsArray = workItemsArray.concat(chunkData);
          } else if (typeof chunkData === 'object' && chunkData !== null) {
            workItemsArray.push(chunkData);
          }
        } catch (parseError) {
          console.error('Error parsing chunk data:', parseError);
          console.log('Raw chunk data:');
          // @ts-ignore
          console.dir(chunk.flowOutputEvent.content.document, {
            depth: null,
            colors: true,
          });
        }
      }
    }

    console.log(`Number of epic work items: ${workItemsArray.length}`);
    console.log('Work items array:');
    console.dir(workItemsArray, { depth: null, colors: true });
    
    return workItemsArray;
  } catch (error) {
    console.error("Error invoking Bedrock Flow:", error);
    throw error;
  }
};




export const listFlows =async (req: Request, res: Response): Promise<void> => {
  console.log('Inside List Flows');
  let flows: { name: string | undefined; id: string | undefined; }[] = [];
  try {
    const response = await bedrockAgentClient.send(new ListFlowsCommand({maxResults: 100}));
    console.log("Available Flows:", response);

    response.flowSummaries?.forEach((flow)=>{
      flows.push({"name":flow.name, "id":flow.id})
    })

    res.status(200).send(flows);
  } catch (error) {
    console.error("Error listing Bedrock Flows:", error);
    res.status(400).send(error);
  }
};
