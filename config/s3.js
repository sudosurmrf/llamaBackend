import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'llama-bakery-images';

// Upload a file to S3
export const uploadToS3 = async (file, folder = 'products') => {
  const key = `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  // Return the public URL
  const url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

  return {
    key,
    url,
  };
};

// Delete a file from S3
export const deleteFromS3 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
  return true;
};

// Get a signed URL for private files (if needed)
export const getSignedUrlForFile = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
};

// Extract key from S3 URL or custom domain URL
export const extractKeyFromUrl = (url) => {
  if (!url) return null;

  try {
    // Clean up the URL (remove whitespace/newlines)
    const cleanUrl = url.trim();

    const urlObj = new URL(cleanUrl);

    // Check if it's a standard S3 URL (bucket.s3.region.amazonaws.com)
    if (urlObj.hostname.includes('.s3.') && urlObj.hostname.includes('.amazonaws.com')) {
      // Standard S3 URL format: https://bucket.s3.region.amazonaws.com/key
      return urlObj.pathname.substring(1); // Remove leading slash
    }

    // Check if it's an S3 path-style URL (s3.region.amazonaws.com/bucket)
    if (urlObj.hostname.startsWith('s3.') && urlObj.hostname.includes('.amazonaws.com')) {
      // Path-style: https://s3.region.amazonaws.com/bucket/key
      const parts = urlObj.pathname.substring(1).split('/');
      if (parts.length > 1) {
        return parts.slice(1).join('/'); // Remove bucket name, return rest as key
      }
    }

    // For custom domain (CloudFront or custom domain pointing to S3)
    // The pathname after the leading slash IS the S3 key
    const pathname = urlObj.pathname.substring(1);

    // Validate it looks like an S3 key (should contain folder structure or valid filename)
    // S3 keys typically have format: folder/timestamp-filename.ext
    if (pathname && (pathname.includes('/') || pathname.match(/^\d+-.*\.\w+$/))) {
      return pathname;
    }

    // If it's just a UUID or similar (like 0a8ddcde-1958-4d58-8aab-412b973f1032)
    // This is likely NOT a valid S3 key we created, skip deletion
    console.warn(`URL does not appear to be an S3 key we created: ${cleanUrl}`);
    return null;
  } catch (err) {
    console.error('Failed to parse URL for S3 key extraction:', url, err);
    return null;
  }
};

export default s3Client;
