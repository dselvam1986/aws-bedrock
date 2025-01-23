
import { Request, Response } from 'express';
import fs from "fs";
import { LambdaClient, InvokeCommand, InvocationRequest } from "@aws-sdk/client-lambda";
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import path from 'path';
import { Upload } from '@aws-sdk/lib-storage';
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
    
    let result = await invokeLambdaFunction(fileUrls)
    
    let extractedText = getExtractedTextFromBody(result.body);

    console.log("extractedText", extractedText);

    // save extracted text to S3
    let saveText = uploadTextToS3(extractedText[0], originalName);

  // then use lambda function to get text and same it back to s3 - get key for the text ref
  // pass the key and prompt to bedrock. 
  // get structured result from bedrock.

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

// Function to upload extracted text to S3
const uploadTextToS3 = async (extractedText: any, fileName: string,  bucketName = process.env.REACT_APP_S3_BUCKET_NAME) => {
  console.log('[UPLOAD_TXT_TO_S3] Starting the txt upload process.');
  const uploadedTextResult = [];

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
        console.log("key should be here", result);
 
        uploadedTextResult.push(result)

    } catch (error) {
        console.error(
            `[UPLOAD_TXT_TO_S3] Error uploading TXT`
        );
        throw error;
    }
 
  return uploadedTextResult;
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
   
      console.log(
        '[INVOKE_LAMBDA_FUNCTION] Received response from Lambda function:',
        jsonResponse
      );
   
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

/**
 * Extracts the `extractedText` values from the Lambda response body.
 *
 * @param {Object} body - The response body from the Lambda function.
 * @returns {Array} An array of extracted text values.
 */
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
  