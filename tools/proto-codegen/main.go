package main

import (
	"os"
	"os/exec"
	"strings"
)

func main() {
	goPlugin := tool("protoc-gen-go")
	grpcPlugin := tool("protoc-gen-go-grpc")
	command := exec.Command("protoc", "-I", "browser-worker/protocol", "--plugin=protoc-gen-go="+goPlugin, "--plugin=protoc-gen-go-grpc="+grpcPlugin, "--go_out=browser-worker/protocol", "--go_opt=paths=source_relative", "--go-grpc_out=browser-worker/protocol", "--go-grpc_opt=paths=source_relative", "worker.proto")
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		panic(err)
	}
}
func tool(name string) string {
	output, err := exec.Command("go", "tool", "-n", name).Output()
	if err != nil {
		panic(err)
	}
	return strings.TrimSpace(string(output))
}
