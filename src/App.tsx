import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "./lib/auth";
import { AppQueryProvider } from "./lib/query";
import { router } from "./routes/router";

const App = () => (
  <AuthProvider>
    <AppQueryProvider>
      <RouterProvider router={router} />
    </AppQueryProvider>
  </AuthProvider>
);

export default App;
