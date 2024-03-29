import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket, BucketEncryption, BucketPolicy, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Key } from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { aws_redshiftserverless as redshiftserverless } from 'aws-cdk-lib';
import { createKMSKeyPolicy } from './kms-policy';
import { 
  createLambdaPolicy, 
  createCloudwatchLogsPolicy, 
  createNonSecureCloudwatchLogPolicy,
  createCLWs3ACLPolicy,
  createCLWs3PutObjPolicy 
} from './s3_bucket_policies';
import * as constants from './constants';

export class MyCdkDemoAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const s3_to_redshift_role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('redshift.amazonaws.com'),
      roleName: constants.ROLE_NAME,
    });

    // Add managed policies
    s3_to_redshift_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonRedshiftFullAccess'));
    s3_to_redshift_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
    s3_to_redshift_role.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/ROSAKMSProviderPolicy',
    });

    const cfnNamespace = new redshiftserverless.CfnNamespace(this, 'MyCfnNamespace', {
      namespaceName: constants.NAMESPACE_NAME,
      dbName: constants.DB_NAME,
      adminUsername: constants.ADMIN_USERNAME,
      adminUserPassword: constants.ADMIN_PASSWORD,
      defaultIamRoleArn: s3_to_redshift_role.roleArn,
      iamRoles: [s3_to_redshift_role.roleArn],
    });

    const cfnWorkgroup = new redshiftserverless.CfnWorkgroup(this, 'MyCfnWorkgroup', {
      workgroupName: constants.WORKGROUP_NAME,
      namespaceName: cfnNamespace.namespaceName,
      configParameters: [
        {
          parameterKey: 'max_query_execution_time',
          parameterValue: '14400',
        },
      ],
      securityGroupIds: constants.SECURITY_GROUP_IDS,
      subnetIds: constants.SUBNET_IDS,
    });

    cfnWorkgroup.addDependency(cfnNamespace);

    const myKMSkeyPolicy = createKMSKeyPolicy(s3_to_redshift_role.roleArn);

    const s3KMSKeyForData = new Key(this, 'MyKMSkey', {
      alias: constants.KMS_ALIAS,
      enabled: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      policy: myKMSkeyPolicy,
      pendingWindow: cdk.Duration.days(7),
    });

    const s3DataBucket = new Bucket(this, 'Mys3Bucket', {
      bucketName: constants.BUCKET_NAME,
      versioned: true,
      encryption: BucketEncryption.KMS,
      encryptionKey: s3KMSKeyForData,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      }
    });

    // Add policies to the bucket's resource policy
    const s3BucketLambdaPolicy = createLambdaPolicy(s3DataBucket.bucketArn);
    // const s3BucketCloudWatchPolicy = createCloudWatchPolicy(s3DataBucket.bucketArn);
    const s3BucketCloudWatchLogPolicy = createCloudwatchLogsPolicy(s3DataBucket.bucketArn);
    const s3NonSecureCloudWatchPolicy = createNonSecureCloudwatchLogPolicy(s3DataBucket.bucketArn);

    s3DataBucket.addToResourcePolicy(s3BucketLambdaPolicy);
    // s3DataBucket.addToResourcePolicy(s3BucketCloudWatchPolicy);
    s3DataBucket.addToResourcePolicy(s3BucketCloudWatchLogPolicy);
    s3DataBucket.addToResourcePolicy(s3NonSecureCloudWatchPolicy);


    const s3BucketCloudWatchLogs = new Bucket(this, 's3BucketCloudWatchLogs', {
      bucketName: constants.CLOUDWATCH_BUCKET_NAME,
      versioned: true,
      encryption: BucketEncryption.KMS,
      encryptionKey: s3KMSKeyForData,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const CLWs3ACLPolicy = createCLWs3ACLPolicy(s3BucketCloudWatchLogs.bucketArn);
    const CLWs3PutObjPolicy = createCLWs3PutObjPolicy(s3BucketCloudWatchLogs.bucketArn);
    s3BucketCloudWatchLogs.addToResourcePolicy(CLWs3ACLPolicy);
    s3BucketCloudWatchLogs.addToResourcePolicy(CLWs3PutObjPolicy);

  }
}
