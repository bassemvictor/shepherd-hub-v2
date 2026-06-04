import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "./lib/auth";
import { router } from "./routes/router";

const App = () => (
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
);

export default App;
