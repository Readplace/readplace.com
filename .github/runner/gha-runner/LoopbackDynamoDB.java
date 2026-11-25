import com.amazonaws.services.dynamodbv2.local.server.LocalDynamoDBRequestHandler;
import com.amazonaws.services.dynamodbv2.local.server.LocalDynamoDBServerHandler;
import java.net.InetSocketAddress;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;

// The DynamoDB Local CLI accepts a port but binds to every interface.
final class LoopbackDynamoDB {
    public static void main(String[] args) {
        try {
            serve();
        } catch (Exception error) {
            error.printStackTrace();
            System.exit(1);
        }
        // DynamoDB Local's background executors can outlive the closed database.
        System.exit(0);
    }

    private static void serve() throws Exception {
        var server = new Server(new InetSocketAddress("127.0.0.1", 0));
        boolean inMemory = true;
        boolean sharedDb = true;
        var database = new LocalDynamoDBRequestHandler(0, inMemory, null, sharedDb, false);
        server.setHandler(new LocalDynamoDBServerHandler(database, null));
        try {
            server.start();
            var connector = (ServerConnector) server.getConnectors()[0];
            System.out.println("http://127.0.0.1:" + connector.getLocalPort());
            // The parent owns stdin. EOF also cleans up after a cancelled test.
            System.in.read();
        } finally {
            server.stop();
            database.shutdown();
        }
    }
}
