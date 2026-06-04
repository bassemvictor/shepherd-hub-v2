import { Amplify } from "aws-amplify";

import outputs from "../../amplify_outputs.json";

type AmplifyOutputs = {
  auth?: {
    user_pool_id?: string;
    user_pool_client_id?: string;
  };
};

Amplify.configure(outputs, { ssr: false });

const authOutputs = (outputs as AmplifyOutputs).auth;

export const isAmplifyAuthConfigured = Boolean(
  authOutputs?.user_pool_id && authOutputs?.user_pool_client_id,
);
