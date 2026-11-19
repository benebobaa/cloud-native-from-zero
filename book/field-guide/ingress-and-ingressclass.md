# Ingress and IngressClass

## What and why

An Ingress is a set of HTTP and HTTPS routing rules: a host and path on the way in, a Service on the way out. Many Services can share one external entry point instead of one load balancer each.

An Ingress does nothing alone. An **Ingress controller** that you install watches Ingress objects and configures a proxy; `IngressClass` (referenced by `spec.ingressClassName`) says which controller owns an Ingress. The Ingress API is frozen: it stays generally available with no plan to remove it, but new features go to Gateway API. The ingress-nginx project is retired: best-effort maintenance ended in March 2026, and its [repository was archived on 24 March 2026](https://github.com/kubernetes/ingress-nginx), so it gets no releases or fixes.

## Diagram

{{diagram ingress-and-ingressclass-01.jsx | Ingress request path · 5 boxes}}
The Ingress holds the rules; the controller named by its IngressClass watches it and proxies matching requests to the Service.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16), with the `web` Service from the Service card. A controller must exist first. This test used the ingress-nginx manifest for kind, controller image v1.15.1 (the project is retired; it is used here only because its manifest runs on kind):

```
$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
$ kubectl get ingressclass
NAME    CONTROLLER             PARAMETERS   AGE
nginx   k8s.io/ingress-nginx   <none>       34s
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: web}
spec:
  ingressClassName: nginx
  rules:
  - host: web.example.test
    http:
      paths:
      - {path: /, pathType: Prefix, backend: {service: {name: web, port: {number: 80}}}}
```

From a client Pod, call the controller's Service with the host name in the `Host` header. A request with another host finds no rule:

```
$ kubectl get ingress
NAME   CLASS   HOSTS              ADDRESS   PORTS   AGE
web    nginx   web.example.test             80      9s

$ kubectl exec client -- wget -qO- -T 5 --header 'Host: web.example.test' http://ingress-nginx-controller.ingress-nginx.svc | grep -i '<title>'
<title>Welcome to nginx!</title>

$ kubectl exec client -- wget -S -qO- -T 5 http://ingress-nginx-controller.ingress-nginx.svc 2>&1 | head -2
  HTTP/1.1 404 Not Found
wget: server returned error: HTTP/1.1 404 Not Found
```

The ADDRESS column stays empty here: on kind nothing publishes an external address.

## Key fields

Checked with `kubectl explain ingress` and `ingressclass` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.ingressClassName` | the IngressClass whose controller should serve this Ingress | unset; the docs recommend a default IngressClass |
| `spec.rules[].host` | precise name (`foo.bar.com`) or wildcard (`*.foo.com`); no IPs or ports | unset: rule applies to all hosts |
| `...paths[].path` | URL path; must start with `/` and be present for `Exact` and `Prefix` | none |
| `...paths[].pathType` | `Exact`, `Prefix` (element by element) or `ImplementationSpecific` | required |
| `...paths[].backend.service` | `name` plus `port.number` or `port.name` of the target Service | required |
| `spec.defaultBackend` | where requests matching no rule go | unset: the controller decides |
| `spec.tls[]` | `hosts` and `secretName`; only port 443 | none |
| IngressClass `spec.controller` | controller name string, such as `k8s.io/ingress-nginx` | required by convention |
| IngressClass `spec.parameters` | optional reference to a custom resource with controller settings | none |

## kubectl

```bash
kubectl create ingress web --class=nginx --rule="web.example.test/=web:80"   # imperative create
kubectl get ingress,ingressclass          # CLASS, HOSTS, ADDRESS
kubectl describe ingress web              # Rules, backends with endpoints, Events
kubectl -n ingress-nginx get pods         # is the controller running?
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller   # why a route fails
kubectl exec client -- wget -S -qO- -T 5 --header 'Host: web.example.test' http://<controller-service>
```

## How it fails

Reproduced with the ingress-nginx controller above.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The Ingress "bad-nopathtype" is invalid: spec.rules[0].http.paths[0].pathType: Required value: pathType must be specified` | `pathType` is mandatory in `networking.k8s.io/v1` | Set `Exact`, `Prefix` or `ImplementationSpecific` |
| `HTTP/1.1 503 Service Temporarily Unavailable`; `kubectl describe ingress ghost` shows `does-not-exist:80 (<error: services "does-not-exist" not found>)` | The backend Service name is wrong or has no ready endpoints | Fix the Service name or port; check `kubectl get endpointslice` |
| Nothing happens: `noclass   traefik   ...   ADDRESS` empty and `Events: <none>` | `ingressClassName: traefik` names a class that no installed controller serves; there is no error | Use an IngressClass that exists and has a controller (`kubectl get ingressclass`) |

The ingress-nginx admission webhook also rejects a clash with an existing rule: `admission webhook "validate.nginx.ingress.kubernetes.io" denied the request: host "web.example.test" and path "/" is already defined in ingress default/web`.

## Related

- **Cards:** Service, Gateway API (the successor), DNS for Services and Pods
- **Chapter and lab:** Ch 6.2 and Lab 6.2
- **Exam:** CKA and CKAD, Services and Networking (20%): Ingress
- **Source:** [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/), [Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
